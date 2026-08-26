import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, openSync, closeSync, rmSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { ConfigSchema, type Config, type Target } from "./schema.js";
import { configPath } from "./paths.js";
import { DEFAULT_CONFIG_TOML } from "./defaults.js";

export class ConfigError extends Error {}

/** Reads, parses, and validates the config. Throws ConfigError on any problem. */
export function loadConfig(path = configPath()): Config {
  if (!existsSync(path)) {
    throw new ConfigError(
      `No Fusion config at ${path}. Run \`fusion init\` to create one.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`Could not read ${path}: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = parseToml(raw);
  } catch (err) {
    throw new ConfigError(`Invalid TOML in ${path}: ${(err as Error).message}`);
  }

  const result = ConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config in ${path}:\n${issues}`);
  }
  const cfg = result.data;
  const internal = process.env.FUSION_LANGFUSE_INTERNAL_HOST?.trim();
  if (internal) {
    for (const t of cfg.targets) {
      if (t.managed) t.host = internal;
    }
  }
  return cfg;
}

/** Writes DEFAULT_CONFIG_TOML if absent. Returns { path, created }. */
export function initConfig(path = configPath()): { path: string; created: boolean } {
  if (existsSync(path)) return { path, created: false };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, DEFAULT_CONFIG_TOML, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return { path, created: true };
}

/**
 * Serializes and writes a validated config atomically: write a temp file, fsync
 * via writeFileSync, then rename over the target (atomic on the same filesystem)
 * under a coarse lock. Guards crash-corruption and CLI/UI lost-update races.
 */
export function saveConfig(cfg: Config, path = configPath()): void {
  const result = ConfigSchema.safeParse(cfg);
  if (!result.success) {
    throw new ConfigError(`Refusing to save invalid config: ${result.error.message}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  withLock(path, () => {
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, stringifyToml(result.data), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path); // atomic replace
    chmodSync(path, 0o600);
  });
}

/** Best-effort exclusive lock via an O_EXCL lockfile, with a short bounded spin. */
function withLock<T>(path: string, fn: () => T): T {
  const lock = `${path}.lock`;
  const spin = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 100; i++) {
    let fd: number | undefined;
    try {
      fd = openSync(lock, "wx"); // fails if the lock exists
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      Atomics.wait(spin, 0, 0, 10); // ~10ms backoff, synchronously
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      rmSync(lock, { force: true });
    }
  }
  throw new ConfigError(`could not acquire config lock (${lock}); another process may be writing`);
}

/** Active target if it exists; null when none is defined yet. */
export function tryActiveTarget(cfg: Config): Target | null {
  if (cfg.activeTarget) return cfg.targets.find((t) => t.name === cfg.activeTarget) ?? null;
  return cfg.targets.length === 1 ? cfg.targets[0] : null;
}

/** Returns the active target, or throws ConfigError if it can't be resolved. */
export function activeTarget(cfg: Config): Target {
  const t = tryActiveTarget(cfg);
  if (!t) {
    throw new ConfigError(
      `No Langfuse target is defined. Add one with \`fusion target add\` or \`fusion host --local\`.`,
    );
  }
  return t;
}
