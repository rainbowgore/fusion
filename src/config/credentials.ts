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

export function targetHasOrgKeys(t: Pick<Target, "orgPublicKey" | "orgSecretKey">): boolean {
  return Boolean(t.orgPublicKey?.trim() && t.orgSecretKey?.trim());
}

export function orgKeysFromEnv(env: NodeJS.ProcessEnv = process.env): { orgPublicKey: string; orgSecretKey: string } {
  return {
    orgPublicKey: (env.LANGFUSE_ORG_PUBLIC_KEY || env.LANGFUSE_ORG_PK || "").trim(),
    orgSecretKey: (env.LANGFUSE_ORG_SECRET_KEY || env.LANGFUSE_ORG_SK || "").trim(),
  };
}

export const MCP_CONNECT_NEEDS_ORG_KEY =
  "fusion connect needs a Langfuse organization-scoped API key (Organization Settings → API Keys) so Fusion MCP can list and govern org projects on Cursor and Hermes. Set LANGFUSE_ORG_PUBLIC_KEY and LANGFUSE_ORG_SECRET_KEY, then re-run connect. Keys stay in Fusion config — they are not written into Cursor or Hermes MCP files.";

/** Apply env org keys onto the active (or first cloud) target. Does not prompt. */
export function ensureOrgScopedKeys(
  cfg: Config,
  env: NodeJS.ProcessEnv = process.env,
  opts: { persist?: boolean } = {},
): { ok: boolean; message: string } {
  const persist = opts.persist !== false;
  const fromEnv = orgKeysFromEnv(env);
  const target =
    cfg.targets.find((t) => t.name === cfg.activeTarget) ??
    cfg.targets.find((t) => t.kind === "cloud") ??
    cfg.targets[0];
  if (!target) return { ok: false, message: MCP_CONNECT_NEEDS_ORG_KEY };
  if (!targetHasOrgKeys(target) && fromEnv.orgPublicKey && fromEnv.orgSecretKey) {
    target.orgPublicKey = fromEnv.orgPublicKey;
    target.orgSecretKey = fromEnv.orgSecretKey;
    if (persist) saveConfig(cfg);
  }
  if (targetHasOrgKeys(target)) return { ok: true, message: `Organization-scoped key is set on target "${target.name}".` };
  return { ok: false, message: MCP_CONNECT_NEEDS_ORG_KEY };
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
