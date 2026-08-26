import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { backupFileLayered } from "../platform/paths.js";

/** Path fragment Fusion writes into Hermes `model.base_url`. */
export const HERMES_GW_MARK = "/gw/hermes";

const OAUTH_PROVIDERS = new Set([
  "nous",
  "openai-codex",
  "qwen-oauth",
  "minimax-oauth",
  "copilot",
  "copilot-acp",
]);

export type HermesShape = "openai" | "anthropic";

export interface HermesCapture {
  /** Request/usage shape the gateway must speak for this Hermes. */
  shape: HermesShape;
  /** Real provider API Fusion forwards to (BYOK). */
  upstream: string;
  previousProvider: string;
  previousBaseUrl: string;
}

export type HermesRunner = (args: string[]) => { status: number; stdout: string; stderr: string };

export function hermesBin(): string {
  return process.env.FUSION_HERMES_BIN?.trim() || "hermes";
}

export function hermesConfigFile(): string {
  if (process.env.FUSION_HERMES_CONFIG?.trim()) return process.env.FUSION_HERMES_CONFIG.trim();
  const home = process.env.HERMES_HOME?.trim();
  return join(home && home !== "" ? home : join(homedir(), ".hermes"), "config.yaml");
}

export function runHermes(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(hermesBin(), args, { encoding: "utf8", timeout: 20_000 });
  if (r.error) {
    const err = r.error as NodeJS.ErrnoException;
    return { status: err.code === "ENOENT" ? 127 : 1, stdout: r.stdout ?? "", stderr: err.message };
  }
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function hermesConfigGet(key: string, run: HermesRunner = runHermes): string {
  const r = run(["config", "get", key]);
  return r.status === 0 ? r.stdout.trim() : "";
}

/** Map a Hermes `model.provider` to gateway shape + default upstream. */
export function mapHermesProvider(provider: string, currentBaseUrl: string): { ok: true; shape: HermesShape; upstream: string } | { ok: false; message: string } {
  const p = provider.trim().toLowerCase();
  if (!p) return { ok: false, message: "Hermes has no model.provider; run `hermes model` first." };
  if (OAUTH_PROVIDERS.has(p)) {
    return {
      ok: false,
      message: `Hermes provider "${p}" is OAuth — Fusion cannot intercept that path. Switch Hermes to a key-based provider (anthropic, openai, openrouter, custom) then retry.`,
    };
  }
  if (p === "anthropic") return { ok: true, shape: "anthropic", upstream: "https://api.anthropic.com" };
  if (p === "openai") return { ok: true, shape: "openai", upstream: "https://api.openai.com" };
  if (p === "openrouter") return { ok: true, shape: "openai", upstream: "https://openrouter.ai/api" };
  if (p === "custom") {
    const u = currentBaseUrl.trim();
    if (!u || u.includes(HERMES_GW_MARK)) {
      return { ok: false, message: "Hermes custom provider needs a real model.base_url before Fusion can proxy it." };
    }
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, message: `Hermes model.base_url is not http(s): ${u}` };
      }
    } catch {
      return { ok: false, message: `Hermes model.base_url is not a URL: ${u}` };
    }
    return { ok: true, shape: "openai", upstream: u.replace(/\/+$/, "") };
  }
  return {
    ok: false,
    message: `Hermes provider "${p}" is not a Fusion-governable capture path yet (need a key-based HTTP API).`,
  };
}

export function hermesCaptureWired(cfgText?: string): boolean {
  const text = cfgText ?? (existsSync(hermesConfigFile()) ? readFileSync(hermesConfigFile(), "utf8") : "");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (/^base_url:\s*/.test(t) && t.includes(HERMES_GW_MARK)) return true;
  }
  return false;
}

/**
 * Point Hermes at Fusion's gateway via `hermes config set` (never hand-edit YAML).
 * Keeps the user's provider; only `model.base_url` is redirected. Keys stay in Hermes `.env`.
 */
export function enableHermes(
  gatewayPort: number,
  token: string,
  run: HermesRunner = runHermes,
): { ok: boolean; message: string; capture?: HermesCapture } {
  const probe = run(["config", "path"]);
  if (probe.status === 127) {
    return { ok: false, message: "hermes CLI not found on PATH. Install Hermes, then `fusion enable hermes`." };
  }
  if (probe.status !== 0) {
    return { ok: false, message: `hermes config path failed: ${(probe.stderr || probe.stdout).trim()}` };
  }

  const cfgPath = hermesConfigFile();
  if (existsSync(cfgPath) && hermesCaptureWired(readFileSync(cfgPath, "utf8"))) {
    return { ok: true, message: `Hermes already pointed at Fusion gateway (${cfgPath}). Restart Hermes.` };
  }

  const provider = hermesConfigGet("model.provider", run);
  const previousBaseUrl = hermesConfigGet("model.base_url", run);
  const mapped = mapHermesProvider(provider, previousBaseUrl);
  if (!mapped.ok) return { ok: false, message: mapped.message };

  const upstream =
    previousBaseUrl.startsWith("http://") || previousBaseUrl.startsWith("https://")
      ? previousBaseUrl.replace(/\/+$/, "")
      : mapped.upstream;

  if (existsSync(cfgPath)) backupFileLayered(cfgPath, "hermes-config.yaml");

  const anthropicMark = mapped.shape === "anthropic" ? "/anthropic" : "";
  const base = `http://127.0.0.1:${gatewayPort}/k/${token}${HERMES_GW_MARK}${anthropicMark}`;
  const set = run(["config", "set", "model.base_url", base]);
  if (set.status !== 0) {
    return { ok: false, message: `hermes config set model.base_url failed: ${(set.stderr || set.stdout).trim()}` };
  }

  const capture: HermesCapture = {
    shape: mapped.shape,
    upstream,
    previousProvider: provider,
    previousBaseUrl,
  };
  return {
    ok: true,
    capture,
    message:
      `Governed Hermes: model.base_url → ${base} (shape ${mapped.shape}, upstream ${upstream}). ` +
      `Key stays in Hermes. Restart Hermes. Traces tag service:hermes.`,
  };
}

export function disableHermes(
  capture: HermesCapture | undefined,
  run: HermesRunner = runHermes,
): { ok: boolean; message: string } {
  const cfgPath = hermesConfigFile();
  if (existsSync(cfgPath)) backupFileLayered(cfgPath, "hermes-config.yaml");

  if (capture?.previousBaseUrl) {
    const set = run(["config", "set", "model.base_url", capture.previousBaseUrl]);
    if (set.status !== 0) {
      return { ok: false, message: `hermes config set restore failed: ${(set.stderr || set.stdout).trim()}` };
    }
    return { ok: true, message: `Restored Hermes model.base_url to ${capture.previousBaseUrl}. Restart Hermes.` };
  }

  const unset = run(["config", "unset", "model.base_url"]);
  if (unset.status !== 0 && hermesCaptureWired()) {
    return { ok: false, message: `hermes config unset model.base_url failed: ${(unset.stderr || unset.stdout).trim()}` };
  }
  return { ok: true, message: "Removed Fusion gateway from Hermes model.base_url. Restart Hermes." };
}
