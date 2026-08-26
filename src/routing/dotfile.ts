import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * The `.fusion` dotfile: a THIN per-directory pointer (project, optional target).
 * Fusion's central config stays the source of truth for targets/keys — this file
 * only declares intent, legibly, next to the code it governs.
 */
export interface Dotfile {
  project: string;
  target?: string;
}

export const DOTFILE_NAME = ".fusion";

export function dotfilePath(dir: string): string {
  return join(resolve(dir), DOTFILE_NAME);
}

/** Project/target identifiers: safe charset only (no shell metacharacters). */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateName(kind: "project" | "target", v: string): void {
  if (!NAME_RE.test(v)) {
    throw new Error(`invalid ${kind} name "${v}" — allowed: letters, digits, . _ - (start alphanumeric, ≤128 chars)`);
  }
}

/** Reads + validates a `.fusion`. Returns null on missing/malformed/unsafe (item 17). */
export function readDotfile(dir: string): Dotfile | null {
  const p = dotfilePath(dir);
  if (!existsSync(p)) return null;
  let data: Record<string, unknown>;
  try {
    data = parseToml(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch (err) {
    console.error(`[fusion] ignoring malformed ${p}: ${(err as Error).message}`);
    return null;
  }
  if (typeof data.project !== "string" || !NAME_RE.test(data.project)) {
    if (data.project != null) console.error(`[fusion] ignoring ${p}: invalid project value`);
    return null;
  }
  const target = typeof data.target === "string" && NAME_RE.test(data.target) ? data.target : undefined;
  return { project: data.project, target };
}

export function writeDotfile(dir: string, df: Dotfile): string {
  validateName("project", df.project);
  if (df.target) validateName("target", df.target);
  const p = dotfilePath(dir);
  const body =
    `# fusion route — thin pointer; central config owns targets/keys.\n` +
    stringifyToml(df.target ? { project: df.project, target: df.target } : { project: df.project });
  writeFileSync(p, body + "\n", "utf8");
  return p;
}

export function removeDotfile(dir: string): boolean {
  const p = dotfilePath(dir);
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}

/**
 * Walk up from `dir` to the filesystem root, returning the nearest `.fusion` and
 * its directory. This is what the shell hook resolves on directory entry —
 * most-specific (deepest) directory wins.
 */
export function findNearestDotfile(startDir: string): { dir: string; dotfile: Dotfile } | null {
  let cur = resolve(startDir);
  const root = parsePath(cur).root;
  for (;;) {
    const df = readDotfile(cur);
    if (df) return { dir: cur, dotfile: df };
    if (cur === root) return null;
    cur = dirname(cur);
  }
}
