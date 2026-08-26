#!/usr/bin/env node
/**
 * Core daemon entrypoint — spawned detached by `fusion up`. Loads config, starts
 * the control + gateway listeners, writes its pidfile, and stays up until killed.
 */
import { loadConfig } from "../config/load.js";
import { startCore } from "./daemon.js";
import { writePid, clearPid, writeHeartbeat } from "./state.js";
import { HEARTBEAT_MS } from "../platform/limits.js";

async function main() {
  const cfg = loadConfig();
  writePid(process.pid);
  writeHeartbeat();
  const core = startCore(cfg);
  const beat = setInterval(writeHeartbeat, HEARTBEAT_MS);
  beat.unref();

  const shutdown = async () => {
    clearInterval(beat);
    await core.close();
    clearPid();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(`fusion-core up — control :${cfg.ports.daemon}  gateway :${cfg.ports.gateway}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
