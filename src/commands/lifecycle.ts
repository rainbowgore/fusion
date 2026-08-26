import type { Command } from "commander";
import { existsSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import { ensureLangfuse } from "../langfuse/discover.js";
import { detectDocker, dockerReady, dockerNotReadyReason } from "../platform/docker.js";
import { compose } from "../platform/compose.js";
import { ensureBridgeVendored, buildBridge, runBridge, stopBridge } from "../platform/bridge.js";
import { langfuseStackDir, backupsDir, codexConfigPath } from "../platform/paths.js";
import { readStackInfo } from "../langfuse/stack.js";
import { startDaemon, stopDaemon } from "../core/lifecycle.js";

/** Phase 1 — `fusion up` / `fusion down`. Docker Compose is only for local Langfuse. */
export function registerLifecycleCommands(program: Command): void {
  program
    .command("up")
    .description("Start Fusion; local Langfuse Compose only when sink is docker-local")
    .option("--no-bridge", "Skip the OTLP bridge (and skip Compose for docker-local)")
    .action(async (opts: Record<string, unknown>) => {
      const cfg = loadConfig();
      const { target } = await ensureLangfuse(cfg);

      const sink = cfg.sink;
      if (!sink) {
        console.error("Run `fusion init` first and pick Docker local, cloud, or gateway-only.");
        process.exit(1);
      }

      const useDockerCore = sink === "docker-local" && Boolean(target?.managed) && opts.bridge !== false;
      if (sink === "docker-local" && !target?.managed) {
        if (!target) {
          console.error("Docker local sink needs `fusion host --local`, or a local Langfuse Fusion can discover.");
          process.exit(1);
        }
        console.log(`Using existing Langfuse at ${target.host} (not starting a Fusion-managed stack).`);
      }
      if (useDockerCore) {
        const docker = await detectDocker();
        if (!dockerReady(docker)) {
          console.error("Local Fusion runs in Docker so it stays up after a crash. Start Docker Desktop and retry.");
          console.error(dockerNotReadyReason(docker));
          process.exit(1);
        }
      }

      const d = await startDaemon(cfg, useDockerCore ? "docker" : "process");
      console.log(
        d.started
          ? useDockerCore
            ? `✓ Fusion core container up — control :${cfg.ports.daemon}  gateway :${cfg.ports.gateway} (restart unless-stopped)`
            : `✓ Core daemon up — control :${cfg.ports.daemon}  gateway :${cfg.ports.gateway}`
          : `Core daemon: ${d.reason}`,
      );
      if (!d.started && d.reason !== "already running") process.exit(1);

      if (opts.bridge === false || sink === "gateway-only") {
        if (sink === "gateway-only") console.log("Gateway-only: OTLP bridge not started. Node daemon will die if that process crashes.");
        else console.log("Skipped OTLP bridge (--no-bridge).");
        return;
      }

      if (sink === "cloud" && target?.managed) {
        console.error("Cloud sink points at a managed local stack. Use `fusion init --sink docker-local` or a cloud host/keys.");
        process.exit(1);
      }

      const docker = await detectDocker();
      if (!dockerReady(docker)) {
        if (sink === "docker-local") {
          console.error("Local Langfuse needs Docker Desktop.");
          console.error(dockerNotReadyReason(docker));
          process.exit(1);
        }
        console.log("Cloud Langfuse is up via keys. OTLP bridge skipped (Docker not running) — Cursor/Hermes gateway still works.");
        console.log("Start Docker only if you want Claude Code / Codex OTLP, then re-run `fusion up`.");
        return;
      }

      if (!target) {
        console.error("No Langfuse target. Add host + keys (`fusion target add`) or `fusion host --local` before starting the OTLP bridge.");
        process.exit(1);
      }

      console.log("Vendoring + building the OTLP bridge (first run pulls the repo)…");
      await ensureBridgeVendored();
      await buildBridge();
      await runBridge(cfg, target);
      console.log(`✓ Bridge running on :${cfg.ports.bridge} → ${target.managed ? "local Langfuse" : target.host}`);
      console.log("Run `fusion doctor` to verify the whole chain.");
    });

  program
    .command("down")
    .description("Stop the bridge (and managed stack). --purge also removes data + restores backups.")
    .option("--purge", "Remove containers, volumes, generated stack, and restore edited user files", false)
    .action(async (opts: Record<string, unknown>) => {
      const purge = Boolean(opts.purge);
      const sink = loadConfig().sink;
      console.log(stopDaemon() ? "Stopped the core daemon." : "Core daemon not running.");
      await stopBridge();
      console.log("Stopped the bridge.");

      const stack = readStackInfo();
      if (stack && existsSync(stack.dir) && (purge || sink === "docker-local")) {
        const args = purge ? ["down", "-v"] : ["down"];
        console.log(`Stopping local Langfuse stack (${purge ? "and removing volumes" : "keeping data"})…`);
        await compose(stack.dir, args);
      }

      if (purge) {
        restoreBackups();
        const dir = langfuseStackDir();
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
          console.log(`Removed generated stack at ${dir}.`);
        }
        console.log("Purge complete. Config left in place (edit or delete it manually).");
      }
    });
}

/** Restore the user files Fusion backed up (best-effort, only known tags). */
function restoreBackups(): void {
  const dir = backupsDir();
  const codexBak = join(dir, "codex-config.toml.bak");
  if (existsSync(codexBak)) {
    copyFileSync(codexBak, codexConfigPath());
    console.log(`Restored ${codexConfigPath()} from backup.`);
  }
}
