import type { Command } from "commander";
import { loadConfig, saveConfig } from "../config/load.js";
import { enableCodex, enableClaudeCode, enableHermes } from "../sources/enable.js";
import { getOrCreateGatewayToken } from "../core/auth.js";

/** `fusion enable claude-code | codex | hermes`. Safe, idempotent, backed-up. */
export function registerEnableCommand(program: Command): void {
  program
    .command("enable <source>")
    .description("Enable a source: claude-code | codex | hermes")
    .option("--endpoint <url>", "OTLP bridge endpoint (defaults to config ports.bridge on 127.0.0.1)")
    .option("--log-prompts", "Store prompt text in Langfuse (privacy tradeoff)", false)
    .action((source: string, opts: Record<string, unknown>) => {
      const cfg = loadConfig();
      const otlp = (opts.endpoint as string) || `http://127.0.0.1:${cfg.ports.bridge}`;

      let result: { ok: boolean; message: string };
      if (source === "codex") result = enableCodex(otlp, Boolean(opts.logPrompts));
      else if (source === "claude-code") result = enableClaudeCode(otlp, Boolean(opts.logPrompts));
      else if (source === "hermes") {
        const h = enableHermes(cfg.ports.gateway, getOrCreateGatewayToken());
        result = h;
        if (h.ok && h.capture) cfg.hermesCapture = h.capture;
      } else {
        console.error(`Unknown source "${source}". Use: claude-code | codex | hermes.`);
        process.exit(1);
      }
      console.log(result.message);
      if (!result.ok) process.exit(1);

      cfg.sources[source as "codex" | "claude-code" | "hermes"] = true;
      saveConfig(cfg);
      console.log(`Marked source "${source}" enabled in config.`);
    });
}
