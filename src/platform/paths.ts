import { homedir, platform } from "node:os";
import { join } from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

/**
 * Cross-platform path resolution. No hardcoded personal paths — everything is
 * derived from the OS + standard env vars, honoring overrides for tests.
 */

const isMac = platform() === "darwin";

/** Fusion's data dir (vendored bridge, compose files, backups, generated keys). */
export function dataDir(): string {
  if (process.env.FUSION_DATA_DIR) return process.env.FUSION_DATA_DIR;
  if (isMac) return join(homedir(), "Library", "Application Support", "fusion");
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".local", "share");
  return join(base, "fusion");
}

/** Where Fusion vendors the OTLP bridge clone. */
export function bridgeDir(): string {
  return join(dataDir(), "bridge", "claude-code-telemetry");
}

/** Where Fusion writes the machine-local Langfuse docker-compose project.
 *  Shared across Fusion config re-inits on this account (new CLI user vs
 *  someone who already ran `fusion host --local`). Override with FUSION_STACK_DIR. */
export function langfuseStackDir(): string {
  if (process.env.FUSION_STACK_DIR?.trim()) return process.env.FUSION_STACK_DIR.trim();
  return join(dataDir(), "langfuse");
}

/** Directory holding timestamped backups of user files Fusion edits. */
export function backupsDir(): string {
  return join(dataDir(), "backups");
}

/** The user's Codex CLI config (Fusion appends an [otel] block here, safely). */
export function codexConfigPath(): string {
  if (process.env.FUSION_CODEX_CONFIG) return process.env.FUSION_CODEX_CONFIG;
  return join(homedir(), ".codex", "config.toml");
}

/** Cursor's local chat store (Phase 5 subscription path). Platform-specific. */
export function cursorStorePath(): string {
  if (process.env.FUSION_CURSOR_STORE) return process.env.FUSION_CURSOR_STORE;
  if (isMac) {
    return join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "Cursor", "User", "globalStorage", "state.vscdb");
}

/**
 * Copy a user file to the backups dir with a stable, deterministic name before
 * Fusion edits it. Returns the backup path, or null if the source doesn't exist.
 * Deterministic (no timestamp) so it works without Date.now and is idempotent.
 */
export function backupFile(src: string, tag: string): string | null {
  if (!existsSync(src)) return null;
  const dir = backupsDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${tag}.bak`);
  copyFileSync(src, dest);
  return dest;
}

/**
 * Layered backup: always writes a timestamped copy, and preserves the FIRST-ever
 * copy as `<tag>.orig` (never overwritten) so the true pre-Fusion original is
 * recoverable even after multiple enable/disable cycles. Returns the .orig path.
 */
export function backupFileLayered(src: string, tag: string): string | null {
  if (!existsSync(src)) return null;
  const dir = backupsDir();
  mkdirSync(dir, { recursive: true });
  copyFileSync(src, join(dir, `${tag}.${Date.now()}.bak`));
  const orig = join(dir, `${tag}.orig`);
  if (!existsSync(orig)) copyFileSync(src, orig);
  return orig;
}

export function origBackupPath(tag: string): string {
  return join(backupsDir(), `${tag}.orig`);
}
