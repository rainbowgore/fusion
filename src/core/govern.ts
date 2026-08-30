import { loadConfig, saveConfig, tryActiveTarget } from "../config/load.js";
import { assertLinkableDir } from "../routing/containment.js";
import { targetHasKeys } from "../config/credentials.js";
import { readStackInfo } from "../langfuse/stack.js";
import { dockerLangfuseInitTargets } from "../langfuse/discover.js";
import { type Config, TargetSchema, type Target } from "../config/schema.js";
import { LangfuseClient } from "../langfuse/client.js";
import { writeDotfile } from "../routing/dotfile.js";
import { syncPrices } from "../langfuse/prices.js";
import { enableCodex, enableClaudeCode, enableHermes } from "../sources/enable.js";
import { getOrCreateGatewayToken } from "./auth.js";

/**
 * The Govern actions the control API exposes — each a thin wrapper over the same
 * config + engine functions the CLI uses. Config is re-loaded per action so the
 * daemon and CLI never fight over a stale snapshot.
 */

export async function govTargetTest(input: { host: string; publicKey: string; secretKey: string }): Promise<{ ok: boolean; message: string }> {
  const v = await new LangfuseClient({ host: input.host, publicKey: input.publicKey, secretKey: input.secretKey }).validate();
  return { ok: v.ok, message: v.message };
}

export async function govTargetAdd(input: { name: string; host: string; publicKey: string; secretKey: string; kind?: string; project?: string; use?: boolean; validate?: boolean }): Promise<{ ok: boolean; message: string }> {
  const cfg = loadConfig();
  if (cfg.targets.some((t) => t.name === input.name)) return { ok: false, message: `A target named "${input.name}" already exists.` };
  const candidate = TargetSchema.parse({
    name: input.name,
    kind: input.kind ?? "cloud",
    host: input.host,
    publicKey: input.publicKey,
    secretKey: input.secretKey,
    project: input.project ?? "default",
    managed: false,
  });
  if (input.validate !== false) {
    const v = await new LangfuseClient(candidate).validate();
    if (!v.ok) return { ok: false, message: v.message };
  }
  cfg.targets.push(candidate);
  if (input.use !== false) cfg.activeTarget = candidate.name;
  saveConfig(cfg);
  return { ok: true, message: `Added target "${candidate.name}".` };
}

export async function govTargetSetKeys(input: { name: string; publicKey: string; secretKey: string; validate?: boolean }): Promise<{ ok: boolean; message: string }> {
  const cfg = loadConfig();
  const t = cfg.targets.find((x) => x.name === input.name);
  if (!t) return { ok: false, message: `No target named "${input.name}".` };
  const updated = { ...t, publicKey: input.publicKey, secretKey: input.secretKey };
  if (input.validate !== false) {
    const v = await new LangfuseClient(updated).validate();
    if (!v.ok) return { ok: false, message: v.message };
  }
  Object.assign(t, updated);
  saveConfig(cfg);
  return { ok: true, message: `Keys set for "${input.name}".` };
}

export function govSetActive(input: { name: string }): { ok: boolean; message: string } {
  const cfg = loadConfig();
  if (!cfg.targets.some((t) => t.name === input.name)) return { ok: false, message: `No target named "${input.name}".` };
  cfg.activeTarget = input.name;
  saveConfig(cfg);
  return { ok: true, message: `Active target is now "${input.name}".` };
}

export function priceSyncCandidates(cfg: Config, extras: Target[] = []): Target[] {
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const t of [tryActiveTarget(cfg), ...cfg.targets, ...extras]) {
    if (!t || !targetHasKeys(t)) continue;
    const k = `${originKey(t.host)}|${t.publicKey}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function originKey(host: string): string {
  try {
    const u = new URL(host);
    return `${u.protocol}//${u.host}`;
  } catch {
    return host;
  }
}

function asLocalTarget(name: string, extra: { host: string; publicKey: string; secretKey: string; project?: string }, managed = false): Target {
  return TargetSchema.parse({
    name,
    kind: "local",
    host: extra.host,
    publicKey: extra.publicKey,
    secretKey: extra.secretKey,
    project: extra.project ?? "default",
    managed,
  });
}

export async function govPricesSync(): Promise<{ ok: boolean; message: string }> {
  const cfg = loadConfig();
  const extras: Target[] = [];
  let n = 0;
  for (const d of await dockerLangfuseInitTargets()) {
    extras.push(asLocalTarget(`docker-init-${++n}`, d));
  }
  const stack = readStackInfo();
  if (stack) extras.push(asLocalTarget("local-stack", { host: stack.host, publicKey: stack.publicKey, secretKey: stack.secretKey, project: stack.projectId }, true));
  const candidates = priceSyncCandidates(cfg, extras);
  if (!candidates.length) return { ok: false, message: "No Langfuse target with keys. Add keys that match that host, or start a local stack." };

  let last = "Keys rejected.";
  for (const t of candidates) {
    const r = await syncPrices(t);
    if (r.ok) return { ok: true, message: `${r.message} (${t.host})` };
    last = `${r.message} (${t.host})`;
  }
  return { ok: false, message: `${last} Keys must belong to that instance — cloud keys will not work on a local Langfuse.` };
}

export function govEnableSource(input: { source: string; logPrompts?: boolean }): { ok: boolean; message: string } {
  const cfg = loadConfig();
  const otlp = `http://127.0.0.1:${cfg.ports.bridge}`;
  if (input.source === "codex") {
    const result = enableCodex(otlp, Boolean(input.logPrompts));
    if (result.ok) {
      cfg.sources.codex = true;
      saveConfig(cfg);
    }
    return result;
  }
  if (input.source === "claude-code") {
    const result = enableClaudeCode(otlp, Boolean(input.logPrompts));
    if (result.ok) {
      cfg.sources["claude-code"] = true;
      saveConfig(cfg);
    }
    return result;
  }
  if (input.source === "hermes") {
    const result = enableHermes(cfg.ports.gateway, getOrCreateGatewayToken());
    if (result.ok) {
      cfg.sources.hermes = true;
      if (result.capture) cfg.hermesCapture = result.capture;
      saveConfig(cfg);
    }
    return { ok: result.ok, message: result.message };
  }
  return { ok: false, message: `Unknown source "${input.source}".` };
}

export function govProjectLink(input: { dir: string; project: string; target?: string }): { ok: boolean; message: string } {
  const cfg = loadConfig();
  const abs = assertLinkableDir(input.dir);
  if (input.target && !cfg.targets.some((t) => t.name === input.target)) return { ok: false, message: `No target named "${input.target}".` };
  const file = writeDotfile(abs, { project: input.project, target: input.target });
  const idx = cfg.links.findIndex((l) => l.dir === abs);
  const entry = { dir: abs, project: input.project, ...(input.target ? { target: input.target } : {}) };
  if (idx >= 0) cfg.links[idx] = entry;
  else cfg.links.push(entry);
  saveConfig(cfg);
  return { ok: true, message: `Linked ${abs} → project:${input.project} (wrote ${file}).` };
}
