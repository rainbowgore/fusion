import type { Command } from "commander";
import { loadConfig } from "../config/load.js";
import { ensureLangfuse } from "../langfuse/discover.js";
import { syncPrices } from "../langfuse/prices.js";
import { LangfuseClient } from "../langfuse/client.js";

/** `fusion prices sync` (bulk) + `fusion prices set` (single) on the active target. */
export function registerPricesCommand(program: Command): void {
  const prices = program.command("prices").description("Manage model prices on the active target");

  prices
    .command("sync")
    .description("Register Fusion's model-price set so Langfuse computes cost")
    .option("--file <path>", "Custom price definitions JSON (defaults to the bundled set)")
    .action(async (opts: Record<string, unknown>) => {
      const { target } = await ensureLangfuse(loadConfig());
      if (!target) {
        console.error("No Langfuse found. Run `fusion init` so Fusion can discover a local or cloud instance.");
        process.exit(1);
      }
      const r = await syncPrices(target, opts.file as string | undefined);
      console.log(r.message);
      if (!r.ok) process.exit(1);
    });

  prices
    .command("set <modelName>")
    .description("Register/edit one model price (USD per token)")
    .requiredOption("--match <regex>", "match pattern against the observation model name")
    .option("--input <price>", "input price per token", parseFloat)
    .option("--output <price>", "output price per token", parseFloat)
    .option("--unit <unit>", "TOKENS | CHARACTERS | SECONDS | REQUESTS", "TOKENS")
    .action(async (modelName: string, opts: Record<string, unknown>) => {
      const { target } = await ensureLangfuse(loadConfig());
      if (!target) {
        console.error("No Langfuse found. Run `fusion init` so Fusion can discover a local or cloud instance.");
        process.exit(1);
      }
      const r = await new LangfuseClient(target).createModel({
        modelName,
        matchPattern: String(opts.match),
        unit: opts.unit as any,
        inputPrice: opts.input as number | undefined,
        outputPrice: opts.output as number | undefined,
      });
      console.log(r.ok ? `Registered price for ${modelName}.` : `Failed (HTTP ${r.status}).`);
      if (!r.ok) process.exit(1);
    });
}
