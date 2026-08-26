import type { Command } from "commander";
import { existsSync } from "node:fs";
import { initConfig, loadConfig, saveConfig } from "../config/load.js";
import { configPath } from "../config/paths.js";
import { type Config } from "../config/schema.js";
import { collectLangfuseCreds, stripPlaceholderLangfuseTargets, upsertLangfuseTarget } from "../config/credentials.js";
import { ask, isInteractive } from "../platform/tty.js";
import {
  discoverAndRemember,
  formatDiscovery,
  type DiscoveredWithCreds,
} from "../langfuse/discover.js";

export type InitSink = "docker-local" | "cloud" | "gateway-only";
export type InitAction = InitSink | "use-local" | "use-cloud";

export function parseInitSink(raw: string): InitSink | null {
  const v = raw.trim().toLowerCase();
  if (v === "docker" || v === "docker-local" || v === "local") return "docker-local";
  if (v === "2" || v === "cloud" || v === "remote") return "cloud";
  if (v === "3" || v === "gateway" || v === "gateway-only" || v === "gw") return "gateway-only";
  if (v === "1") return "docker-local";
  return null;
}

export function parseInitAction(raw: string, found: DiscoveredWithCreds[]): InitAction | null {
  const v = raw.trim().toLowerCase();
  if (v === "use-local" || v === "existing-local") return "use-local";
  if (v === "use-cloud" || v === "existing-cloud") return "use-cloud";
  const sink = parseInitSink(v);
  if (sink && (v === "docker-local" || v === "cloud" || v === "gateway-only" || v === "docker" || v === "gateway" || v === "gw" || v === "remote" || v === "local")) {
    if (v === "local" && found.some((d) => d.kind === "local" && d.healthy)) return "use-local";
    return sink;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return parseInitSink(v);
  const menu = initMenuActions(found);
  return menu[n - 1] ?? null;
}

export function initMenuActions(found: DiscoveredWithCreds[]): InitAction[] {
  const actions: InitAction[] = [];
  if (found.some((d) => d.kind === "local" && d.healthy)) actions.push("use-local");
  if (found.some((d) => d.kind === "cloud")) actions.push("use-cloud");
  actions.push("docker-local", "cloud", "gateway-only");
  return [...new Set(actions)];
}

export function initMenuText(found: DiscoveredWithCreds[]): string {
  const actions = initMenuActions(found);
  const local = found.find((d) => d.kind === "local" && d.healthy);
  const cloud = found.find((d) => d.kind === "cloud");
  const lines = ["How should traces land?"];
  actions.forEach((a, i) => {
    const n = String(i + 1);
    if (a === "use-local") lines.push(`  ${n}) Use existing local Langfuse at ${local?.host}`);
    else if (a === "use-cloud") lines.push(`  ${n}) Use Langfuse Cloud at ${cloud?.host}`);
    else if (a === "docker-local") lines.push(`  ${n}) Start a new Fusion Docker Langfuse (only if you do not already have one)`);
    else if (a === "cloud") lines.push(`  ${n}) Cloud Langfuse (enter a host + keys)`);
    else lines.push(`  ${n}) Gateway only (no Langfuse on this machine)`);
  });
  lines.push(`Choice [1-${actions.length}]: `);
  return lines.join("\n");
}

function setSink(cfg: Config, sink: InitSink): void {
  cfg.sink = sink;
}

/** `fusion init` — discover Langfuse the user already has, then choose how traces land. */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("First-run: find existing Langfuse, then Docker / cloud / gateway-only")
    .option("--sink <choice>", "docker-local | cloud | gateway-only | use-local | use-cloud")
    .option("--name <name>", "Target name", "default")
    .option("--host <url>", "Langfuse base URL")
    .option("--public-key <pk>", "Langfuse public key (pk-lf-...)")
    .option("--secret-key <sk>", "Langfuse secret key (sk-lf-...)")
    .option("--project <name>", "Langfuse project slug", "default")
    .option("--kind <kind>", "local | cloud", "cloud")
    .option("--no-validate", "Skip the live connection check")
    .action(async (opts: Record<string, unknown>) => {
      const path = configPath();
      const firstRun = !existsSync(path);
      const { created } = initConfig(path);
      if (created) console.log(`Created config at ${path}`);

      const cfg = loadConfig(path);
      console.log("Looking for Langfuse you already have…");
      const found = await discoverAndRemember(cfg, { scanListen: true });
      for (const line of formatDiscovery(found)) console.log("  " + line);

      const hasCloudKeys = Boolean(opts.host && opts.publicKey && opts.secretKey);
      let action: InitAction | null = opts.sink ? parseInitAction(String(opts.sink), found) : null;
      if (opts.sink && !action) {
        console.error(`Unknown --sink "${opts.sink}".`);
        process.exit(1);
      }
      if (!action && hasCloudKeys) action = "cloud";
      if (!action && found.some((d) => d.kind === "local" && d.healthy) && !isInteractive()) action = "use-local";
      if (!action && isInteractive()) {
        process.stdout.write(initMenuText(found));
        action = parseInitAction(await ask(""), found);
        if (!action) {
          console.error("Pick a listed number.");
          process.exit(1);
        }
      }
      if (!action) {
        console.log(initMenuText(found));
        console.log("(non-interactive: fusion init --sink use-local | use-cloud | docker-local | cloud | gateway-only)");
        if (firstRun) console.log("Starter config written.");
        process.exit(1);
      }

      if (action === "use-local") {
        const local = found.find((d) => d.kind === "local" && d.healthy);
        if (!local) {
          console.error("No local Langfuse is up. Start yours, or pick Docker / cloud.");
          process.exit(1);
        }
        setSink(cfg, "cloud");
        saveConfig(cfg, path);
        if (!local.hasKeys) {
          const creds = await collectLangfuseCreds({ host: local.host });
          if (creds) {
            const saved = await upsertLangfuseTarget(cfg, creds, { name: "local", kind: "local", validate: opts.validate !== false });
            console.log(saved.ok ? `✓ ${saved.message}` : saved.message);
          } else {
            console.log(`Using local Langfuse at ${local.host}. Add keys with fusion doctor when you have them.`);
          }
        } else {
          console.log(`Using existing local Langfuse at ${local.host}.`);
        }
        console.log("Next: `fusion up` (bridge to that host; Fusion will not start another Langfuse).");
        return;
      }

      if (action === "use-cloud") {
        const cloud = found.find((d) => d.kind === "cloud");
        setSink(cfg, "cloud");
        saveConfig(cfg, path);
        if (cloud?.hasKeys) console.log(`Using Langfuse Cloud at ${cloud.host}.`);
        else {
          const creds = await collectLangfuseCreds({ host: cloud?.host ?? (opts.host as string | undefined) });
          if (!creds) {
            console.log("Cloud sink saved. Add host/keys with fusion doctor.");
            process.exit(1);
          }
          const saved = await upsertLangfuseTarget(cfg, creds, {
            name: String(opts.name),
            project: opts.project as string | undefined,
            kind: "cloud",
            validate: opts.validate !== false,
          });
          if (!saved.ok) {
            console.error(saved.message);
            process.exit(1);
          }
          console.log(`✓ ${saved.message}`);
        }
        console.log("Next: `fusion up`.");
        return;
      }

      setSink(cfg, action);

      if (action === "gateway-only") {
        stripPlaceholderLangfuseTargets(cfg);
        saveConfig(cfg, path);
        console.log("Using gateway-only. Next: `fusion up` then `fusion enable cursor` / `fusion enable hermes`.");
        return;
      }

      if (action === "docker-local") {
        const local = found.find((d) => d.kind === "local" && d.healthy);
        if (local) {
          console.log(`A local Langfuse is already up at ${local.host}. Fusion will use that instead of starting another.`);
          setSink(cfg, "cloud");
          saveConfig(cfg, path);
          console.log("Next: `fusion up`.");
          return;
        }
        saveConfig(cfg, path);
        console.log("Using Docker local Langfuse. Next: Docker Desktop up, then `fusion host --local` and `fusion up`.");
        return;
      }

      const creds = await collectLangfuseCreds({
        host: opts.host as string | undefined,
        publicKey: opts.publicKey as string | undefined,
        secretKey: opts.secretKey as string | undefined,
      });
      if (!creds) {
        saveConfig(cfg, path);
        console.log("Cloud sink saved without keys. Re-run `fusion init --sink cloud` with host/keys, or `fusion doctor`.");
        process.exit(1);
      }

      const saved = await upsertLangfuseTarget(cfg, creds, {
        name: String(opts.name),
        project: opts.project as string | undefined,
        kind: opts.kind as string | undefined,
        validate: opts.validate !== false,
      });
      if (!saved.ok) {
        console.error(saved.message);
        console.error("Not saved. Fix host/keys (or pass --no-validate) and re-run.");
        process.exit(1);
      }
      console.log(`✓ ${saved.message}`);
      console.log("Next: `fusion up` (Node daemon; no local Langfuse containers).");
    });
}
