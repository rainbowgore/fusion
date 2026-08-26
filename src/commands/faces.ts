import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig, saveConfig } from "../config/load.js";
import { removeDotfile } from "../routing/dotfile.js";
import { codexConfigPath, dataDir, backupFileLayered, langfuseStackDir } from "../platform/paths.js";
import { stripCodexBlock, CODEX_MARKER } from "../sources/enable.js";
import { disableHermes } from "../sources/hermes.js";
import { stopDaemon } from "../core/lifecycle.js";
import { stopBridge } from "../platform/bridge.js";
import { compose } from "../platform/compose.js";
import { readStackInfo } from "../langfuse/stack.js";

/** Face-completeness verbs from §6b: use · route · disable · uninstall. */
export function registerFaceCommands(program: Command): void {
  // Set active target (top-level alias for `target use`).
  program
    .command("use <target>")
    .description("Set the active target")
    .action((name: string) => {
      const cfg = loadConfig();
      if (!cfg.targets.some((t) => t.name === name)) {
        console.error(`No target named "${name}". Run \`fusion target list\`.`);
        process.exit(1);
      }
      cfg.activeTarget = name;
      saveConfig(cfg);
      console.log(`Active target is now "${name}".`);
    });

  // Routes registry (canonical verb; mirrors `project link`/`unlink`).
  const route = program.command("route").description("Directory→project routes (list | rm)");
  route
    .command("list")
    .description("List governance routes")
    .action(() => {
      const cfg = loadConfig();
      if (cfg.links.length === 0) return void console.log("No routes. Link one with `fusion project link <dir> --to <project>`.");
      for (const l of cfg.links) console.log(`project:${l.project.padEnd(16)} ${(l.target ? `target:${l.target}` : "(active target)").padEnd(20)} ${l.dir}`);
    });
  route
    .command("rm <dir>")
    .description("Remove a route (.fusion + registry entry)")
    .action((dir: string) => {
      const cfg = loadConfig();
      const abs = resolve(dir);
      const had = removeDotfile(abs);
      const before = cfg.links.length;
      cfg.links = cfg.links.filter((l) => l.dir !== abs);
      saveConfig(cfg);
      console.log(had || before !== cfg.links.length ? `Removed route at ${abs}.` : `No route at ${abs}.`);
    });

  // Disable a client's capture (reverse of `enable`).
  program
    .command("disable <client>")
    .description("Disable a client's capture: claude-code | codex | hermes")
    .action((client: string) => {
      if (client === "codex") {
        const path = codexConfigPath();
        if (existsSync(path)) {
          const txt = readFileSync(path, "utf8");
          const { changed, text } = stripCodexBlock(txt);
          if (changed) {
            backupFileLayered(path, "codex-config.toml"); // timestamped, before we edit
            writeFileSync(path, text, "utf8");
            console.log(`Removed Fusion's [otel] block from ${path} (user config below it preserved).`);
          } else console.log("Codex was not Fusion-configured (no change).");
        }
      } else if (client === "claude-code") {
        const f = join(dataDir(), "claude-code.env.sh");
        if (existsSync(f)) { rmSync(f); console.log(`Removed ${f}.`); }
        else console.log("Claude Code env file not present (no change).");
      } else if (client === "hermes") {
        const r = disableHermes(loadConfig().hermesCapture);
        console.log(r.message);
        if (!r.ok) process.exit(1);
        const next = loadConfig();
        next.sources.hermes = false;
        delete next.hermesCapture;
        saveConfig(next);
        console.log(`Marked "${client}" disabled.`);
        return;
      } else {
        console.error(`Unknown client "${client}". Use: claude-code | codex | hermes.`);
        process.exit(1);
      }
      const cfg = loadConfig();
      cfg.sources[client as "codex" | "claude-code" | "hermes"] = false;
      saveConfig(cfg);
      console.log(`Marked "${client}" disabled.`);
    });

  // Full teardown (alias-of-intent for `down --purge`).
  program
    .command("uninstall")
    .description("Stop everything, remove the managed stack + data, restore backups")
    .action(async () => {
      console.log(stopDaemon() ? "Stopped core daemon." : "Core daemon not running.");
      await stopBridge();
      const stack = readStackInfo();
      if (stack && existsSync(stack.dir)) {
        console.log("Removing managed Langfuse stack (with volumes)…");
        await compose(stack.dir, ["down", "-v"]);
      }
      // Remove Fusion's codex block ONLY if the file is still Fusion-configured,
      // preserving any user config below it (byte-identical original when none).
      const codexPath = codexConfigPath();
      if (existsSync(codexPath)) {
        const cur = readFileSync(codexPath, "utf8");
        if (cur.includes(CODEX_MARKER)) {
          backupFileLayered(codexPath, "codex-config.toml");
          const { text } = stripCodexBlock(cur);
          writeFileSync(codexPath, text, "utf8");
          console.log(`Removed Fusion's [otel] block from ${codexPath}.`);
        }
      }
      const dir = langfuseStackDir();
      if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); console.log(`Removed ${dir}.`); }
      console.log("Uninstalled Fusion's runtime. Config left in place (delete manually if desired).");
    });
}
