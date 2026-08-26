import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, openSync, mkdirSync } from "node:fs";
import { dataDir, langfuseStackDir } from "../platform/paths.js";
import { compose } from "../platform/compose.js";
import { packageRoot, syncUnifiedCompose, writeFusionRuntimeEnv } from "../langfuse/stack.js";
import { readPid, isAlive, clearPid, daemonRunning, daemonLooksHung } from "./state.js";
import { tcpProbe } from "../platform/net.js";
import { filteredSpawnEnv } from "../platform/spawn-env.js";
import type { Config } from "../config/schema.js";

export async function startDaemon(
  cfg: Config,
  mode: "docker" | "process" = cfg.sink === "docker-local" ? "docker" : "process",
): Promise<{ started: boolean; reason?: string }> {
  const daemonUp = await tcpProbe("127.0.0.1", cfg.ports.daemon, 500);
  const gatewayUp = await tcpProbe("127.0.0.1", cfg.ports.gateway, 500);
  if (daemonUp && gatewayUp) return { started: false, reason: "already running" };
  if (daemonUp || gatewayUp) {
    const which = daemonUp ? "daemon" : "gateway";
    const p = daemonUp ? cfg.ports.daemon : cfg.ports.gateway;
    return { started: false, reason: `${which} port ${p} is already in use by another process (not a Fusion daemon we own)` };
  }

  if (mode === "docker") return startDaemonInDocker(cfg);
  return startDaemonProcess(cfg);
}

/** Docker-local: Fusion core is a compose service with restart: unless-stopped. */
async function startDaemonInDocker(cfg: Config): Promise<{ started: boolean; reason?: string }> {
  const entry = join(packageRoot(), "dist", "core", "run-daemon.js");
  if (!existsSync(entry)) {
    return { started: false, reason: "Docker Fusion needs a build (`npm run build`) so dist/core/run-daemon.js exists" };
  }
  writeFusionRuntimeEnv(cfg);
  syncUnifiedCompose(langfuseStackDir());
  const code = await compose(langfuseStackDir(), ["up", "-d"]);
  if (code !== 0) return { started: false, reason: `docker compose up failed (exit ${code})` };

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await tcpProbe("127.0.0.1", cfg.ports.daemon, 500)) return { started: true };
    await sleep(500);
  }
  return { started: false, reason: `fusion container did not listen on :${cfg.ports.daemon} (is Docker running?)` };
}

async function startDaemonProcess(cfg: Config): Promise<{ started: boolean; reason?: string }> {
  if (daemonLooksHung() && !(await tcpProbe("127.0.0.1", cfg.ports.daemon, 500))) {
    clearPid();
  } else if (daemonRunning()) {
    return { started: false, reason: "already running" };
  }

  const entry = join(packageRoot(), "dist", "core", "run-daemon.js");
  if (!existsSync(entry)) {
    return { started: false, reason: "Fusion needs a build (`npm run build`) so dist/core/run-daemon.js exists" };
  }

  mkdirSync(dataDir(), { recursive: true });
  const logPath = join(dataDir(), "daemon.log");
  const out = openSync(logPath, "a");

  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", out, out],
    env: filteredSpawnEnv(),
  });
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if ((await tcpProbe("127.0.0.1", cfg.ports.daemon, 500)) && daemonRunning()) return { started: true };
    await sleep(200);
  }
  return { started: false, reason: `daemon did not come up on :${cfg.ports.daemon} (see ${logPath})` };
}

export function stopDaemon(): boolean {
  let stopped = false;
  const pid = readPid();
  if (pid != null && isAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      stopped = true;
    } catch {
      /* already gone */
    }
    clearPid();
  } else {
    clearPid();
  }

  const stackDir = langfuseStackDir();
  if (existsSync(join(stackDir, "docker-compose.yml"))) {
    const r = spawnSync("docker", ["compose", "stop", "fusion"], { cwd: stackDir, encoding: "utf8" });
    if (r.status === 0) stopped = true;
  }
  return stopped;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
