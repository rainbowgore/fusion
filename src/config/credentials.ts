import { TargetSchema, type Config, type Target } from "./schema.js";
import { saveConfig } from "./load.js";
import { LangfuseClient } from "../langfuse/client.js";
import { ask, isInteractive } from "../platform/tty.js";

export interface LangfuseCreds {
  host: string;
  publicKey: string;
  secretKey: string;
}

export function targetHasKeys(t: Pick<Target, "publicKey" | "secretKey">): boolean {
  return Boolean(t.publicKey?.trim() && t.secretKey?.trim());
}

/** A target with no keys is not a Langfuse we can open or probe. */
export function isPlaceholderLangfuseTarget(t: Pick<Target, "publicKey" | "secretKey">): boolean {
  return !targetHasKeys(t);
}

export function stripPlaceholderLangfuseTargets(cfg: Config): boolean {
  const before = cfg.targets.length;
  cfg.targets = cfg.targets.filter((t) => targetHasKeys(t));
  if (cfg.targets.length === before) return false;
  if (!cfg.targets.some((t) => t.name === cfg.activeTarget)) {
    cfg.activeTarget = cfg.targets[0]?.name ?? "";
  }
  return true;
}

/** Cloud (and any non-gateway target without keys) should be repaired by init/doctor. */
export function needsLangfuseKeys(cfg: Config, target: Target | null): boolean {
  if (cfg.sink === "gateway-only") return false;
  if (!target) return cfg.sink === "cloud";
  if (target.managed && targetHasKeys(target)) return false;
  return !targetHasKeys(target);
}

export async function collectLangfuseCreds(partial: Partial<LangfuseCreds> = {}): Promise<LangfuseCreds | null> {
  let host = partial.host?.trim() ?? "";
  let publicKey = partial.publicKey?.trim() ?? "";
  let secretKey = partial.secretKey?.trim() ?? "";
  if ((!host || !publicKey || !secretKey) && isInteractive()) {
    if (!host) host = (await ask("Langfuse host URL (the URL you already open — Fusion will not guess): ")).trim();
    if (!publicKey) publicKey = (await ask("Public key (pk-lf-...): ")).trim();
    if (!secretKey) secretKey = (await ask("Secret key (sk-lf-...): ")).trim();
  }
  if (!host || !publicKey || !secretKey) return null;
  return { host, publicKey, secretKey };
}

export async function upsertLangfuseTarget(
  cfg: Config,
  creds: LangfuseCreds,
  opts: { name?: string; project?: string; kind?: string; validate?: boolean } = {},
): Promise<{ ok: boolean; message: string; target?: Target }> {
  const name = opts.name ?? cfg.activeTarget ?? "default";
  const existing = cfg.targets.find((t) => t.name === name);
  const candidate = TargetSchema.parse({
    name,
    kind: opts.kind ?? existing?.kind ?? "cloud",
    host: creds.host,
    publicKey: creds.publicKey,
    secretKey: creds.secretKey,
    project: opts.project ?? existing?.project ?? "default",
    managed: existing?.managed ?? false,
  });
  if (opts.validate !== false) {
    const v = await new LangfuseClient(candidate).validate();
    if (!v.ok) return { ok: false, message: v.message };
  }
  const idx = cfg.targets.findIndex((t) => t.name === candidate.name);
  if (idx >= 0) cfg.targets[idx] = { ...cfg.targets[idx], ...candidate };
  else cfg.targets.push(candidate);
  cfg.activeTarget = candidate.name;
  saveConfig(cfg);
  return { ok: true, message: `Saved keys for target "${candidate.name}" in Fusion config.`, target: candidate };
}
