import type { Config, Target } from "../config/schema.js";
import { tryActiveTarget } from "../config/load.js";
import { targetHasKeys } from "../config/credentials.js";
import { LangfuseClient } from "../langfuse/client.js";
import {
  discoverLangfuse,
  dockerLangfuseScan,
  originFromLangfuseUrl,
  publicDiscovery,
  type DiscoveredLangfuse,
  type DiscoveredWithCreds,
} from "../langfuse/discover.js";
import { hermesCaptureWired } from "../sources/hermes.js";

/**
 * Coverage = governance state, NOT analytics. For each known client: what is its
 * capture mechanism, and is activity actually flowing? "Flowing" is a presence
 * signal (a recent trace tagged for that client), never a cost/volume number —
 * numbers live in Langfuse.
 *
 * If Langfuse cannot be queried, status is "unknown" — not "configured / no activity".
 */

export type FlowStatus = "flowing" | "configured" | "subscription" | "bypassed" | "down" | "unknown";

export interface EndpointCoverage {
  name: string;
  client: string;
  capture: string;
  status: FlowStatus;
  detail: string;
}

export type CoverageProbe =
  | { ok: true }
  | { ok: false; message: string; reason: "no-target" | "unreachable" };

export interface Coverage {
  activeTarget: string;
  activeHost: string;
  langfuseOpenUrl: string;
  probe: CoverageProbe;
  discovered: DiscoveredLangfuse[];
  projects: Array<{ id: string; name: string; host: string }>;
  endpoints: EndpointCoverage[];
  routes: Array<{ dir: string; project: string; target?: string }>;
  scan: { docker: "up" | "down" | "error"; dockerDetail: string };
}

const KNOWN = [
  { client: "claude-code", label: "Claude Code", capture: "otlp" },
  { client: "codex", label: "Codex", capture: "otlp" },
  { client: "cursor", label: "Cursor", capture: "gateway" },
  { client: "hermes", label: "Hermes", capture: "gateway" },
] as const;

function queryableLangfuse(cfg: Config): Target | null {
  const t = tryActiveTarget(cfg);
  if (!t || !targetHasKeys(t)) return null;
  return t;
}

function fromConfiguredTarget(target: Target): DiscoveredWithCreds {
  return {
    host: target.host,
    kind: target.kind,
    source: "config",
    healthy: true,
    hasKeys: targetHasKeys(target),
    projects: [],
    publicKey: target.publicKey ?? "",
    secretKey: target.secretKey ?? "",
  };
}

export async function buildCoverage(cfg: Config, opts?: { live?: boolean }): Promise<Coverage> {
  const live = opts?.live !== false;
  let target = queryableLangfuse(cfg);
  let found: DiscoveredWithCreds[] = [];
  const dockerScan = live ? await dockerLangfuseScan() : { ok: true as const, hosts: [] as string[], detail: "checking" };
  if (live) {
    if (!target) {
      found = await discoverLangfuse(cfg, { scanListen: true });
      target = queryableLangfuse(cfg);
      if (!target) {
        const keyed = found.find((d) => d.hasKeys && d.healthy) ?? found.find((d) => d.hasKeys);
        if (keyed) {
          target = {
            name: "discovered",
            kind: keyed.kind,
            host: keyed.host,
            publicKey: keyed.publicKey,
            secretKey: keyed.secretKey,
            project: keyed.projects[0]?.name ?? "default",
            managed: false,
          };
        }
      }
    } else {
      found = await discoverLangfuse(cfg, { scanListen: true });
      const origin = originFromLangfuseUrl(target.host);
      if (origin && !found.some((d) => d.host === origin)) found.unshift(fromConfiguredTarget(target));
    }
  } else if (target) {
    found = [fromConfiguredTarget(target)];
  }
  const probe = !live
    ? { ok: true as const, flowing: new Set<string>() }
    : target
    ? await langfuseFlowProbe(target)
    : found.some((d) => d.healthy)
      ? { ok: false as const, message: `Langfuse is up at ${found.filter((d) => d.healthy).map((d) => d.host).join(", ")} but Fusion has no keys yet`, reason: "no-target" as const }
      : { ok: false as const, message: "no Langfuse found yet (Docker, MCP, env, local health)", reason: "no-target" as const };

  const noSinkDetail = probe.ok
    ? ""
    : probe.reason === "no-target" && found.some((d) => d.healthy)
      ? `Found Langfuse at ${found.filter((d) => d.healthy).map((d) => d.host).join(", ")}. Keys are missing, so traces cannot be listed.`
      : "No Langfuse found yet. Fusion looks at Docker, MCP config, env, and local processes that speak Langfuse health — it does not invent a port.";
  const unreachableDetail = (msg: string) =>
    `Langfuse unreachable — ${msg}. Not the same as “no activity.”`;

  const endpoints: EndpointCoverage[] = KNOWN.map((k) => {
    const enabled = cfg.sources[k.client as keyof typeof cfg.sources] === true;
    const wiredHermes = k.client === "hermes" ? hermesCaptureWired() : true;
    let status: FlowStatus;
    let detail: string;

    if (k.client === "cursor" && !enabled) {
      status = "subscription";
      detail = "Does not go through Fusion.";
    } else if (k.client === "hermes" && enabled && !wiredHermes) {
      status = "bypassed";
      detail = "Hermes is marked on, but it is not pointed at Fusion yet. Use Setup → Hermes.";
    } else if (!probe.ok) {
      status = enabled ? "unknown" : "down";
      detail = enabled
        ? probe.reason === "no-target"
          ? noSinkDetail
          : unreachableDetail(probe.message)
        : k.capture === "gateway"
          ? "needs gateway endpoint"
          : "not enabled (run `fusion enable`)";
    } else if (probe.flowing.has(k.client)) {
      status = "flowing";
      detail = "recent session seen in Langfuse";
    } else if (enabled) {
      status = "configured";
      detail = "on — run a session in this tool, then check Langfuse";
    } else {
      status = "down";
      detail = k.capture === "gateway" ? "off — turn on in Setup if you use this tool" : "off — turn on in Setup if you use this tool";
    }
    return { name: k.label, client: k.client, capture: k.capture, status, detail };
  });

  for (const e of cfg.endpoints) {
    const flowing = probe.ok && probe.flowing.has(e.client);
    endpoints.push({
      name: e.name,
      client: e.client,
      capture: e.capture,
      status: !probe.ok ? "unknown" : flowing ? "flowing" : e.capture === "none" ? "down" : "configured",
      detail: !probe.ok
        ? probe.reason === "no-target"
          ? noSinkDetail
          : `Langfuse unreachable — ${probe.message}`
        : e.upstream
          ? `gateway → ${e.upstream}`
          : "registered endpoint",
    });
  }

  const localUp = found.find((d) => d.kind === "local" && d.healthy);
  const open = localUp?.host || (target && targetHasKeys(target) ? target.host : "") || found.find((d) => d.healthy)?.host || "";
  const dockerState: Coverage["scan"]["docker"] = dockerScan.ok ? "up" : /Docker error/i.test(dockerScan.detail) ? "error" : "down";
  return {
    activeTarget: target?.name ?? "(none)",
    activeHost: target?.host ?? "",
    langfuseOpenUrl: open,
    probe: probe.ok
      ? { ok: true }
      : { ok: false, message: probe.message, reason: "reason" in probe ? probe.reason : "unreachable" },
    discovered: publicDiscovery(found),
    projects: found.flatMap((d) => d.projects.map((p) => ({ ...p, host: d.host }))),
    endpoints,
    routes: cfg.links.map((l) => ({ dir: l.dir, project: l.project, target: l.target })),
    scan: { docker: dockerState, dockerDetail: dockerScan.detail },
  };
}

export async function langfuseFlowProbe(
  target: Target,
): Promise<{ ok: true; flowing: Set<string> } | { ok: false; message: string; reason: "unreachable" }> {
  if (!target.publicKey || !target.secretKey) {
    return { ok: false, message: "no Langfuse keys", reason: "unreachable" };
  }
  const client = new LangfuseClient(target);
  const from = new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    await client.listTraces({ page: 1, limit: 1, fromTimestamp: from });
  } catch (err) {
    return { ok: false, message: (err as Error).message, reason: "unreachable" };
  }
  const flowing = new Set<string>();
  await Promise.all(
    KNOWN.map(async (k) => {
      try {
        const res = await client.listTraces({
          page: 1,
          limit: 1,
          tags: [`service:${k.client}`],
          fromTimestamp: from,
        });
        if (res.meta.totalItems > 0 || res.data.length > 0) flowing.add(k.client);
      } catch {
        /* a tagged lookup failing is not "Langfuse down" */
      }
    }),
  );
  return { ok: true, flowing };
}

