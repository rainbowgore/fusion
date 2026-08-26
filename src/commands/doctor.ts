import type { Command } from "commander";
import { runHealthChecks, printChecks, worstStatus, type Check } from "../health.js";
import { loadConfig, ConfigError } from "../config/load.js";
import { collectLangfuseCreds, needsLangfuseKeys, upsertLangfuseTarget } from "../config/credentials.js";
import { ensureLangfuse } from "../langfuse/discover.js";
import { isInteractive } from "../platform/tty.js";

/** Phase 1 — `fusion doctor` (full, live) and `fusion status` (quick, no live calls). */
export function registerDoctorCommands(program: Command): void {
  program
    .command("doctor")
    .description("Health-check the chain; collect/repair Langfuse keys when they are missing")
    .option("--no-deep", "Skip live Langfuse calls")
    .option("--no-fix", "Do not prompt for or apply keys")
    .option("--host <url>", "Langfuse host to save if keys are missing")
    .option("--public-key <pk>", "Langfuse public key (pk-lf-...)")
    .option("--secret-key <sk>", "Langfuse secret key (sk-lf-...)")
    .action(async (opts: Record<string, unknown>) => {
      let checks = await runHealthChecks(opts.deep !== false);
      printChecks(checks);

      const allowFix = opts.fix !== false;
      if (allowFix) {
        const repaired = await maybeRepairKeys(opts, checks);
        if (repaired) {
          console.log("");
          console.log("Re-checking after saving keys…");
          checks = await runHealthChecks(opts.deep !== false);
          printChecks(checks);
        }
      }

      const worst = worstStatus(checks);
      if (worst === "fail") process.exit(1);
    });

  program
    .command("status")
    .description("Quick status (no live Langfuse calls)")
    .action(async () => {
      const checks = await runHealthChecks(false);
      printChecks(checks);
    });
}

async function maybeRepairKeys(opts: Record<string, unknown>, checks: Check[]): Promise<boolean> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) return false;
    throw err;
  }
  const { target } = await ensureLangfuse(cfg);
  if (cfg.sink === "gateway-only" && !target) return false;
  const missing = needsLangfuseKeys(cfg, target);
  const flags = Boolean(opts.host || opts.publicKey || opts.secretKey);
  const langfuseFail = checks.some((c) => c.name === "langfuse" && c.status === "fail");
  if (!missing && !flags && !langfuseFail) return false;
  if (langfuseFail && !missing && !flags && !isInteractive()) {
    console.error("Langfuse check failed. Repair keys with:");
    console.error("  fusion doctor --host <url> --public-key pk-lf-... --secret-key sk-lf-...");
    return false;
  }

  const creds = await collectLangfuseCreds({
    host: (opts.host as string | undefined) || target?.host,
    publicKey: opts.publicKey as string | undefined,
    secretKey: opts.secretKey as string | undefined,
  });
  if (!creds) {
    if (!isInteractive()) {
      console.error("Langfuse keys missing. Run `fusion doctor` in a terminal, or:");
      console.error("  fusion doctor --host <url> --public-key pk-lf-... --secret-key sk-lf-...");
      console.error("Keys are stored in Fusion config (not in Cursor mcp.json).");
    }
    return false;
  }
  const saved = await upsertLangfuseTarget(cfg, creds, { validate: true });
  console.log(saved.ok ? `✓ ${saved.message}` : `✗ ${saved.message}`);
  return saved.ok;
}
