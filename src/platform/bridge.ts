import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSecretEnvFile } from "./secret-file.js";
import { bridgeDir, dataDir } from "./paths.js";
import type { Config, Target } from "../config/schema.js";
import { COMPOSE_PROJECT } from "../langfuse/stack.js";
import { BRIDGE_CMD_TIMEOUT_MS } from "./limits.js";
import { spawnExit } from "./spawn.js";

const pexec = promisify(execFile);
const BRIDGE_REPO = "https://github.com/lainra/claude-code-telemetry.git";
// Pin to a fixed commit so `apply.py`'s anchors and the Dockerfile are reproducible
// (HEAD drift is what silently breaks the Codex patch). Override with FUSION_BRIDGE_REF.
const BRIDGE_REF = process.env.FUSION_BRIDGE_REF || "5ae1fc3c5efe600f9e84380385813c34e3c86a21";
const BRIDGE_IMAGE = "fusion-bridge:latest";
const BRIDGE_CONTAINER = "fusion-bridge";

/** Path to the vendored Codex patch (assets/codex-support), resolved from dist or src. */
function codexPatchDir(): string {
  // compiled: dist/platform/bridge.js → ../../assets; source (tsx): src/platform → ../../assets
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "assets", "codex-support");
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  return spawnExit(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    timeoutMs: BRIDGE_CMD_TIMEOUT_MS,
  });
}

/** Clone the bridge at the pinned ref if absent, then (re)apply the Codex patch. */
export async function ensureBridgeVendored(): Promise<void> {
  const dir = bridgeDir();

  // Preconditions with friendly errors.
  if (!(await hasCommand("git"))) throw new Error("`git` not found on PATH — required to fetch the OTLP bridge.");
  if (!(await hasCommand("python3"))) throw new Error("`python3` not found on PATH — required to apply the Codex telemetry patch.");

  if (!existsSync(join(dir, "src"))) {
    // Clean any partial/failed prior clone so we start fresh + reproducible.
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    // Pinned checkout: init + fetch the exact ref (works for full SHAs, unlike --depth clone of a branch).
    if ((await run("git", ["init", "-q", dir])) !== 0) throw new Error("git init for the bridge failed");
    if ((await run("git", ["-C", dir, "remote", "add", "origin", BRIDGE_REPO])) !== 0) throw new Error("git remote add failed");
    const fetched = await run("git", ["-C", dir, "fetch", "--depth", "1", "origin", BRIDGE_REF]);
    if (fetched !== 0) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`git fetch of bridge ref ${BRIDGE_REF} failed — check network / FUSION_BRIDGE_REF.`);
    }
    if ((await run("git", ["-C", dir, "checkout", "-q", "FETCH_HEAD"])) !== 0) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`git checkout of bridge ref ${BRIDGE_REF} failed.`);
    }
  }

  if (!existsSync(join(dir, "Dockerfile"))) {
    throw new Error(`bridge clone at ${dir} has no Dockerfile — the pinned ref may be wrong (FUSION_BRIDGE_REF).`);
  }

  const patch = join(codexPatchDir(), "apply.py");
  if (!existsSync(patch)) throw new Error(`Codex patch not found at ${patch} — the package may be missing its assets/.`);
  const code = await run("python3", [patch], { env: { BRIDGE_DIR: dir } });
  if (code !== 0) throw new Error(`applying the Codex patch failed (exit ${code}) — bridge ref may have drifted.`);
}

async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await pexec(cmd, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function buildBridge(): Promise<void> {
  const code = await run("docker", ["build", "-t", BRIDGE_IMAGE, bridgeDir()]);
  if (code !== 0) throw new Error(`docker build of the bridge failed (exit ${code})`);
}

export async function stopBridge(): Promise<void> {
  await run("docker", ["rm", "-f", BRIDGE_CONTAINER]);
}

/**
 * Run the bridge, supervised (`--restart unless-stopped`) so ingestion survives
 * reboots. For a managed target it joins the Langfuse compose network and talks
 * to `langfuse-web:3000`; otherwise it points straight at the target host.
 */
export async function runBridge(cfg: Config, target: Target): Promise<void> {
  await stopBridge();
  const host = target.managed
    ? "http://langfuse-web:3000"
    : target.host.replace(/(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i, "$1host.docker.internal");
  const envPath = join(dataDir(), "bridge.env");
  writeSecretEnvFile(envPath, {
    LANGFUSE_PUBLIC_KEY: target.publicKey,
    LANGFUSE_SECRET_KEY: target.secretKey,
    LANGFUSE_HOST: host,
    OTLP_RECEIVER_HOST: "0.0.0.0",
    OTLP_RECEIVER_PORT: "4318",
    NODE_ENV: "production",
    LOG_LEVEL: "info",
  });
  const args = [
    "run", "-d",
    "--name", BRIDGE_CONTAINER,
    "--restart", "unless-stopped",
    "-p", `127.0.0.1:${cfg.ports.bridge}:4318`,
    "--env-file", envPath,
  ];
  if (target.managed) {
    args.push("--network", `${COMPOSE_PROJECT}_default`);
  } else if (host !== target.host) {
    args.push("--add-host", "host.docker.internal:host-gateway");
  }
  args.push(BRIDGE_IMAGE);
  const code = await run("docker", args);
  if (code !== 0) throw new Error(`docker run of the bridge failed (exit ${code})`);
}

export { BRIDGE_CONTAINER };
