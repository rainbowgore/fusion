import type { Command } from "commander";
import { loadConfig, saveConfig, ConfigError } from "../config/load.js";
import { TargetSchema, type Target } from "../config/schema.js";
import { LangfuseClient } from "../langfuse/client.js";

/** Phase 1: manage targets (pure config). `add` optionally live-validates. */
export function registerTargetCommands(program: Command): void {
  const target = program.command("target").description("Manage Langfuse targets (add | use | list)");

  target
    .command("list")
    .description("List configured targets (marks the active one)")
    .action(() => withConfig((cfg) => {
      if (cfg.targets.length === 0) {
        console.log("No targets. Add one with `fusion target add <name> --host <url>`.");
        return;
      }
      for (const t of cfg.targets) {
        const active = t.name === cfg.activeTarget ? "*" : " ";
        const tier = t.managed ? "Tier1/managed" : "Tier0/connect";
        const keys = t.publicKey && t.secretKey ? "keys:set" : "keys:MISSING";
        console.log(`${active} ${t.name.padEnd(16)} ${t.kind.padEnd(6)} ${tier.padEnd(14)} ${keys}  ${t.host}`);
      }
    }));

  target
    .command("use <name>")
    .description("Set the active target")
    .action((name: string) => withConfig((cfg) => {
      if (!cfg.targets.some((t) => t.name === name)) {
        throw new ConfigError(`No target named "${name}". Run \`fusion target list\`.`);
      }
      cfg.activeTarget = name;
      saveConfig(cfg);
      console.log(`Active target is now "${name}".`);
    }));

  target
    .command("add <name>")
    .description("Add a target and set it active")
    .requiredOption("--host <url>", "Langfuse base URL (e.g. https://cloud.langfuse.com)")
    .option("--kind <kind>", "local | cloud", "cloud")
    .option("--public-key <pk>", "Langfuse public key (pk-lf-...)")
    .option("--secret-key <sk>", "Langfuse secret key (sk-lf-...)")
    .option("--project <name>", "Langfuse project slug", "default")
    .option("--managed", "Fusion runs the local Docker stack for this target (Tier 1)", false)
    .option("--no-validate", "Skip the live connection check")
    .option("--no-use", "Do not switch the active target to this one")
    .action(async (name: string, opts: Record<string, unknown>) => {
      const cfg = mustLoad();
      if (cfg.targets.some((t) => t.name === name)) {
        fail(`A target named "${name}" already exists. Remove it or pick another name.`);
      }
      const candidate: Target = TargetSchema.parse({
        name,
        kind: opts.kind,
        host: opts.host,
        publicKey: opts.publicKey ?? "",
        secretKey: opts.secretKey ?? "",
        project: opts.project,
        managed: Boolean(opts.managed),
      });

      if (opts.validate !== false) {
        const result = await new LangfuseClient(candidate).validate();
        console.log(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
        if (!result.ok) {
          console.error("Target not added. Fix the host/keys, or pass --no-validate to add anyway.");
          process.exit(1);
        }
      }

      cfg.targets.push(candidate);
      if (opts.use !== false) cfg.activeTarget = name;
      saveConfig(cfg);
      console.log(`Added target "${name}"${opts.use !== false ? " (now active)" : ""}.`);
    });
}

function mustLoad() {
  try {
    return loadConfig();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function withConfig(fn: (cfg: ReturnType<typeof loadConfig>) => void): void {
  try {
    fn(loadConfig());
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
