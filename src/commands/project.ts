import type { Command } from "commander";
import { resolve } from "node:path";
import { loadConfig, saveConfig } from "../config/load.js";
import { writeDotfile, removeDotfile } from "../routing/dotfile.js";
import { assertLinkableDir } from "../routing/containment.js";
import { effectiveRoute } from "../routing/resolve.js";

/**
 * Phase 1.5 — governance routing. `project link` binds a directory to a project
 * (and optional target) by writing a thin `.fusion` pointer + recording it in the
 * central registry. Attribution is assigned here, not scraped from telemetry.
 */
export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Govern directory→project routing (link | unlink | list | which)");

  project
    .command("link <dir>")
    .description("Link a directory to a project (writes .fusion + registers the route)")
    .requiredOption("--to <project>", "Project name to attribute this directory's activity to")
    .option("--target <name>", "Pin this route to a specific target (defaults to the active target)")
    .action((dir: string, opts: Record<string, unknown>) => {
      const cfg = loadConfig();
      let abs = "";
      try {
        abs = assertLinkableDir(dir);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      const target = opts.target as string | undefined;
      if (target && !cfg.targets.some((t) => t.name === target)) {
        console.error(`No target named "${target}". Run \`fusion target list\`.`);
        process.exit(1);
      }
      const project = String(opts.to);

      const file = writeDotfile(abs, { project, target });
      const idx = cfg.links.findIndex((l) => l.dir === abs);
      const entry = { dir: abs, project, ...(target ? { target } : {}) };
      if (idx >= 0) cfg.links[idx] = entry;
      else cfg.links.push(entry);
      saveConfig(cfg);

      console.log(`Linked ${abs}`);
      console.log(`  → project:${project}${target ? `  target:${target}` : ""}`);
      console.log(`  wrote ${file}`);
      console.log("Add the shell hook so clients self-tag here: `fusion hook zsh` (or bash).");
    });

  project
    .command("unlink <dir>")
    .description("Remove a directory's route (.fusion + registry entry)")
    .action((dir: string) => {
      const cfg = loadConfig();
      const abs = resolve(dir);
      const had = removeDotfile(abs);
      const before = cfg.links.length;
      cfg.links = cfg.links.filter((l) => l.dir !== abs);
      saveConfig(cfg);
      if (!had && before === cfg.links.length) {
        console.log(`No route at ${abs}.`);
        return;
      }
      console.log(`Unlinked ${abs}.`);
    });

  project
    .command("list")
    .description("List all governed routes")
    .action(() => {
      const cfg = loadConfig();
      if (cfg.links.length === 0) {
        console.log("No routes. Link one with `fusion project link <dir> --to <project>`.");
        return;
      }
      for (const l of cfg.links) {
        console.log(`project:${l.project.padEnd(16)} ${l.target ? `target:${l.target}`.padEnd(20) : "(active target)".padEnd(20)} ${l.dir}`);
      }
    });

  project
    .command("which [dir]")
    .description("Show the effective route for a directory (default: cwd)")
    .action((dir?: string) => {
      const route = effectiveRoute(dir ?? process.cwd());
      if (!route) {
        console.log("No route governs this directory (activity would be unattributed by project).");
        return;
      }
      console.log(`project:${route.project}${route.target ? `  target:${route.target}` : ""}   (from ${route.dir})`);
    });
}
