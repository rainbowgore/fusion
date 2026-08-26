import type { Command } from "commander";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { loadConfig } from "../config/load.js";
import { startDaemon } from "../core/lifecycle.js";
import { daemonRunning } from "../core/state.js";

/** `fusion ui` — ensure the core daemon is up, then open its governance console. */
export function registerUiCommand(program: Command): void {
  program
    .command("ui")
    .description("Open the UI — coverage, routing, and health (starts the daemon if needed)")
    .option("--no-open", "Don't open the browser")
    .action(async (opts: Record<string, unknown>) => {
      const cfg = loadConfig();
      if (!daemonRunning()) {
        const d = await startDaemon(cfg);
        if (!d.started && d.reason !== "already running") {
          console.error(`Could not start the core daemon: ${d.reason}`);
          process.exit(1);
        }
      }
      const url = `http://127.0.0.1:${cfg.ports.daemon}`;
      console.log(`UI → ${url}  (active target: ${cfg.activeTarget})`);
      if (opts.open !== false) openBrowser(url);
    });
}

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort */
  }
}
