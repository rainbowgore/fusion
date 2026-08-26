import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ConfigError, tryActiveTarget } from "./config/load.js";
import { targetHasKeys } from "./config/credentials.js";
import type { Config } from "./config/schema.js";
import { LangfuseClient } from "./langfuse/client.js";
import { dockerLangfuseScan, ensureLangfuse } from "./langfuse/discover.js";
import { detectDocker, dockerReady, dockerNotReadyReason } from "./platform/docker.js";
import { stackContainersRunning } from "./langfuse/stack.js";
import { tcpProbe } from "./platform/net.js";
import { codexConfigPath, dataDir } from "./platform/paths.js";
import { ingestSignal } from "./core/signals.js";
import { hermesCaptureWired, hermesConfigFile } from "./sources/hermes.js";
import { spoolDepth } from "./core/buffer.js";

export type CheckStatus = "ok" | "warn" | "fail" | "skip" | "off";
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

const CODEX_MARKER = "# fusion:otel-block";

/** Runs the full chain health-check. `deep` performs live Langfuse calls. */
export async function runHealthChecks(deep = true): Promise<Check[]> {
  const checks: Check[] = [];

  let cfg: Config;
  try {
    cfg = loadConfig();
    checks.push({ name: "config", status: "ok", detail: "loaded and valid" });
  } catch (err) {
    checks.push({ name: "config", status: "fail", detail: err instanceof ConfigError ? err.message : String(err) });
    return checks; // nothing else is meaningful without config
  }

  const { target } = cfg.targets.length
    ? { target: tryActiveTarget(cfg) ?? cfg.targets[0] ?? null }
    : await ensureLangfuse(cfg);
  if (!target) {
    checks.push({
      name: "active-target",
      status: cfg.sink === "gateway-only" ? "skip" : "warn",
      detail: cfg.sink === "gateway-only"
        ? "gateway-only — no Langfuse target"
        : "no Langfuse found yet (Docker, MCP, env, local health) — run fusion init",
    });
  } else if (!targetHasKeys(target)) {
    checks.push({
      name: "active-target",
      status: "warn",
      detail: `${target.name} → ${target.host} (reachable host, keys still needed for traces)`,
    });
  } else {
    checks.push({ name: "active-target", status: "ok", detail: `${target.name} (${target.managed ? "Tier1" : "Tier0"}) → ${target.host}` });
  }

  // Core daemon — the always-on local service hosting the gateway + API.
  const controlUp = await tcpProbe("127.0.0.1", cfg.ports.daemon);
  const gatewayUp = await tcpProbe("127.0.0.1", cfg.ports.gateway);
  checks.push({
    name: "core-daemon",
    status: controlUp ? "ok" : "warn",
    detail: controlUp
      ? `control :${cfg.ports.daemon}${cfg.sink === "docker-local" ? " (container)" : ""}`
      : "not running (start with `fusion up`)",
  });
  checks.push({
    name: "gateway",
    status: gatewayUp ? "ok" : "warn",
    detail: gatewayUp ? `capture chokepoint :${cfg.ports.gateway}` : `not listening on :${cfg.ports.gateway}`,
  });

  const docker = await detectDocker();
  const sink = cfg.sink;
  if (!sink) {
    checks.push({ name: "docker", status: "warn", detail: "no sink chosen yet — run `fusion init`" });
  } else if (sink === "gateway-only") {
    const scan = dockerReady(docker) ? await dockerLangfuseScan() : { ok: false, hosts: [] as string[], detail: "Docker is off" };
    const broken = /Docker error/i.test(scan.detail);
    checks.push({
      name: "docker",
      status: scan.hosts.length ? "ok" : broken ? "fail" : "off",
      detail: scan.hosts.length
        ? `Langfuse in Docker at ${scan.hosts.join(", ")}`
        : broken
          ? scan.detail
          : dockerReady(docker)
            ? "gateway-only — no Langfuse container on this machine"
            : "Docker is off",
    });
  } else if (sink === "docker-local") {
    const dockerOk = dockerReady(docker);
    const containers = dockerOk && (await stackContainersRunning());
    checks.push({
      name: "docker",
      status: dockerOk && containers ? "ok" : dockerOk ? "fail" : "off",
      detail: !dockerOk
        ? `${dockerNotReadyReason(docker)} — local Fusion stays up only while Docker is running`
        : containers
          ? `${docker.version ?? "running"} + fusion-langfuse (Fusion core restarts with Docker)`
          : "Docker is up but fusion-langfuse is not running — `fusion host --local` / `fusion up`",
    });
  } else {
    const scan = dockerReady(docker) ? await dockerLangfuseScan() : { ok: false, hosts: [] as string[], detail: "Docker is off" };
    const broken = /Docker error/i.test(scan.detail);
    checks.push({
      name: "docker",
      status: scan.hosts.length ? "ok" : broken ? "fail" : dockerReady(docker) ? "ok" : "off",
      detail: scan.hosts.length
        ? `Langfuse in Docker at ${scan.hosts.join(", ")}`
        : broken
          ? scan.detail
          : dockerReady(docker)
            ? `${docker.version ?? "running"} — no Langfuse container on this machine`
            : "cloud Langfuse — Docker is only used for a local Langfuse stack",
    });
  }

  const bridgeUp = await tcpProbe("127.0.0.1", cfg.ports.bridge);
  const bridgeNeeded = sink === "docker-local" || sink === "cloud";
  checks.push({
    name: "bridge",
    status: bridgeUp ? "ok" : bridgeNeeded ? "warn" : "skip",
    detail: bridgeUp
      ? `listening on :${cfg.ports.bridge}`
      : bridgeNeeded
        ? `nothing on :${cfg.ports.bridge} — OTLP events would be lost (start it with \`fusion up\`)`
        : "gateway-only — OTLP bridge not started",
  });

  // Langfuse reachability + auth (+ prices), live.
  if (target && targetHasKeys(target) && deep) {
    const client = new LangfuseClient(target);
    const v = await client.validate();
    checks.push({ name: "langfuse", status: v.ok ? "ok" : "fail", detail: v.message });
    if (v.ok) {
      try {
        const models = await client.listModels(1, 1);
        if (models.meta.totalItems === 0) {
          checks.push({ name: "model-prices", status: "warn", detail: "no model prices — cost will be 0 (run `fusion prices sync`)" });
        } else {
          // Truthful coverage: sample recent generations; flag models with tokens but no computed cost.
          let uncovered = new Set<string>();
          try {
            const obs = await client.listObservations({ type: "GENERATION", limit: 50 });
            for (const o of obs.data) {
              const used = (o.usage?.input ?? 0) + (o.usage?.output ?? 0) > 0;
              const priced = (o.calculatedTotalCost ?? 0) > 0;
              if (used && !priced && o.model) uncovered.add(o.model);
            }
          } catch {
            /* observations unavailable — fall back to count only */
          }
          checks.push(
            uncovered.size > 0
              ? { name: "model-prices", status: "warn", detail: `${models.meta.totalItems} prices, but ${uncovered.size} observed model(s) uncovered: ${[...uncovered].slice(0, 5).join(", ")} (run \`fusion prices sync\`)` }
              : { name: "model-prices", status: "ok", detail: `${models.meta.totalItems} prices registered; observed models covered` },
          );
        }
      } catch (err) {
        checks.push({ name: "model-prices", status: "warn", detail: `could not check prices: ${(err as Error).message}` });
      }
    }
  } else if (target) {
    checks.push({
      name: "langfuse",
      status: targetHasKeys(target) ? "skip" : "warn",
      detail: targetHasKeys(target)
        ? `${target.host} — configured, not live-checked`
        : `${target.host} — keys needed`,
    });
  } else {
    checks.push({ name: "langfuse", status: "skip", detail: "no Langfuse target" });
  }

  // Ingestion signal (meaningful in the daemon process): surface emit failures
  // instead of silently dropping (item 9). Only shown once there's activity.
  const sig = ingestSignal();
  const buffered = spoolDepth();
  if (sig.ok + sig.fail > 0 || buffered > 0) {
    const bufMsg = buffered > 0 ? ` · ${buffered} buffered for replay` : "";
    checks.push({
      name: "ingest",
      status: buffered > 0 || sig.fail > 0 ? "warn" : "ok",
      detail: (sig.fail > 0 ? `${sig.fail} emit failure(s) — last: ${sig.lastError}` : `${sig.ok} emitted ok`) + bufMsg,
    });
  }

  // Sources: config flag + whether the on-disk config is actually in place.
  if (cfg.sources.codex) {
    const p = codexConfigPath();
    const configured = existsSync(p) && readFileSync(p, "utf8").includes(CODEX_MARKER);
    checks.push({ name: "source:codex", status: configured ? "ok" : "warn", detail: configured ? `[otel] block present in ${p}` : `enabled in config but ${p} not wired (run \`fusion enable codex\`)` });
  }
  if (cfg.sources["claude-code"]) {
    const f = join(dataDir(), "claude-code.env.sh");
    checks.push({ name: "source:claude-code", status: existsSync(f) ? "ok" : "warn", detail: existsSync(f) ? `env file at ${f}` : "enabled in config but env file missing (run `fusion enable claude-code`)" });
  }
  if (cfg.sources.hermes) {
    const wired = hermesCaptureWired();
    checks.push({
      name: "source:hermes",
      status: wired ? "ok" : "warn",
      detail: wired
        ? `Hermes model.base_url points at Fusion gateway (${hermesConfigFile()})`
        : "enabled in Fusion but Hermes is not pointed at the gateway (run `fusion enable hermes`)",
    });
  }

  return checks;
}

const GLYPH: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗", skip: "·", off: "·" };

export function printChecks(checks: Check[]): void {
  for (const c of checks) {
    console.log(`${GLYPH[c.status]} ${c.name.padEnd(20)} ${c.detail}`);
  }
}

export function worstStatus(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}
