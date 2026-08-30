import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TargetSchema, type Config, type Target } from "../config/schema.js";
import { configPath } from "../config/paths.js";
import { dataDir, langfuseStackDir } from "../platform/paths.js";

const pexec = promisify(execFile);
const hex = (n: number) => randomBytes(n).toString("hex");

/**
 * Two layers:
 *
 * UNIFIED (ships in the Fusion package, same before/after a given machine is
 * set up): assets/langfuse/docker-compose.yml — project name fusion-langfuse,
 * services, images, volume names. Local Fusion is this stack; it is "up" when
 * those containers are running.
 *
 * PERSONAL (this user / this machine): stack .env (secrets + port) and
 * fusion-stack.json (non-secret host/port ids). config.toml holds sink/routes/keys.
 */

export interface StackInfo {
  dir: string;
  webPort: number;
  projectId: string;
  orgId: string;
  publicKey: string;
  secretKey: string;
  host: string;
}

export const COMPOSE_PROJECT = "fusion-langfuse";
export const LOCAL_STACK_TARGET = "local";
/** First host port Fusion tries when *it* starts a Langfuse compose stack. Not a guess at the user's existing Langfuse. */
export const FUSION_MANAGED_LANGFUSE_BIND = 4688;
export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..");
}

/** Personal host paths so the fusion container can mount this machine's config. */
export function writeFusionRuntimeEnv(cfg: Config): void {
  const dir = langfuseStackDir();
  mkdirSync(dir, { recursive: true });
  const envPath = join(dir, ".env");
  const extra: Record<string, string> = {
    FUSION_PACKAGE_ROOT: packageRoot(),
    FUSION_CONFIG_DIR: dirname(configPath()),
    FUSION_DATA_DIR: dataDir(),
    FUSION_DAEMON_PORT: String(cfg.ports.daemon),
    FUSION_GATEWAY_PORT: String(cfg.ports.gateway),
  };
  let body = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [k, v] of Object.entries(extra)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(body)) body = body.replace(re, line);
    else body += `${body.length === 0 || body.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
  writeFileSync(envPath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}

export function packagedComposeFile(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "assets", "langfuse", "docker-compose.yml");
}

export function syncUnifiedCompose(dir: string): void {
  mkdirSync(dir, { recursive: true });
  copyFileSync(packagedComposeFile(), join(dir, "docker-compose.yml"));
}

function keysFromStackEnv(dir: string): { publicKey: string; secretKey: string } {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) return { publicKey: "", secretKey: "" };
  const map = new Map<string, string>();
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    map.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  return {
    publicKey: map.get("LANGFUSE_INIT_PROJECT_PUBLIC_KEY") ?? "",
    secretKey: map.get("LANGFUSE_INIT_PROJECT_SECRET_KEY") ?? "",
  };
}

export function readStackInfo(): StackInfo | null {
  const dir = langfuseStackDir();
  const metaPath = join(dir, "fusion-stack.json");
  if (!existsSync(metaPath)) return null;
  try {
    const info = JSON.parse(readFileSync(metaPath, "utf8")) as StackInfo;
    info.dir = dir;
    const fromEnv = keysFromStackEnv(dir);
    if (!info.publicKey) info.publicKey = fromEnv.publicKey;
    if (!info.secretKey) info.secretKey = fromEnv.secretKey;
    return info;
  } catch {
    return null;
  }
}

function publicStackMeta(info: StackInfo): Omit<StackInfo, "publicKey" | "secretKey"> {
  return { dir: info.dir, webPort: info.webPort, projectId: info.projectId, orgId: info.orgId, host: info.host };
}

/** Drop meta for a stack we just created but failed to start. */
export function discardNewStackMeta(dir: string): void {
  const meta = join(dir, "fusion-stack.json");
  if (existsSync(meta)) rmSync(meta);
}

/**
 * Refresh the unified compose file from the package. Create personal .env +
 * fusion-stack.json only if they do not exist (or force).
 */
export function writeStack(webPort: number, force = false): StackInfo {
  const dir = langfuseStackDir();
  mkdirSync(dir, { recursive: true });
  syncUnifiedCompose(dir);

  const existing = readStackInfo();
  if (existing && !force) return existing;

  const secrets = {
    POSTGRES_PASSWORD: hex(16),
    CLICKHOUSE_PASSWORD: hex(16),
    REDIS_AUTH: hex(16),
    MINIO_ROOT_PASSWORD: hex(16),
    SALT: hex(16),
    ENCRYPTION_KEY: hex(32),
    NEXTAUTH_SECRET: hex(24),
    LANGFUSE_INIT_USER_PASSWORD: hex(12),
  };

  const info: StackInfo = {
    dir,
    webPort,
    orgId: "fusion",
    projectId: "fusion",
    publicKey: `pk-lf-${hex(16)}`,
    secretKey: `sk-lf-${hex(24)}`,
    host: `http://localhost:${webPort}`,
  };

  const envLines = [
    `# Personal secrets for this machine's Fusion Langfuse stack. Do not commit.`,
    ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`),
    `LANGFUSE_WEB_PORT=${webPort}`,
    `LANGFUSE_INIT_ORG_ID=${info.orgId}`,
    `LANGFUSE_INIT_ORG_NAME=Fusion`,
    `LANGFUSE_INIT_PROJECT_ID=${info.projectId}`,
    `LANGFUSE_INIT_PROJECT_NAME=Fusion`,
    `LANGFUSE_INIT_PROJECT_PUBLIC_KEY=${info.publicKey}`,
    `LANGFUSE_INIT_PROJECT_SECRET_KEY=${info.secretKey}`,
    `LANGFUSE_INIT_USER_EMAIL=admin@fusion.local`,
    `LANGFUSE_INIT_USER_NAME=Fusion`,
    "",
  ].join("\n");
  writeFileSync(join(dir, ".env"), envLines, { encoding: "utf8", mode: 0o600 });
  chmodSync(join(dir, ".env"), 0o600);
  writeFileSync(join(dir, "fusion-stack.json"), JSON.stringify(publicStackMeta(info), null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(join(dir, "fusion-stack.json"), 0o600);

  return info;
}

export function applyStackToConfig(cfg: Config, info: StackInfo, targetName = LOCAL_STACK_TARGET): Target {
  const target: Target = TargetSchema.parse({
    name: targetName,
    kind: "local",
    host: info.host,
    publicKey: info.publicKey,
    secretKey: info.secretKey,
    project: info.projectId,
    managed: true,
  });
  const idx = cfg.targets.findIndex((t) => t.name === targetName);
  if (idx >= 0) cfg.targets[idx] = target;
  else cfg.targets.push(target);
  cfg.activeTarget = targetName;
  cfg.sink = "docker-local";
  cfg.ports.langfuseWeb = info.webPort;
  return target;
}

/** True when the unified fusion-langfuse project has at least one running container. */
export async function stackContainersRunning(): Promise<boolean> {
  try {
    const { stdout } = await pexec("docker", ["compose", "-p", COMPOSE_PROJECT, "ps", "-q", "--status", "running"], {
      timeout: 8000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
