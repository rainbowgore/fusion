import type { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "../mcp/server.js";
import { initConfig, loadConfig } from "../config/load.js";
import { ensureOrgScopedKeys } from "../config/credentials.js";
import { ensureLangfuse } from "../langfuse/discover.js";
import { filteredSpawnEnv } from "../platform/spawn-env.js";
import { NPX_MCP_TIMEOUT_MS } from "../platform/limits.js";
import { spawnExit } from "../platform/spawn.js";
import {
  cursorMcpPath,
  fusionMcpServers,
  hermesConfigPath,
  mergeMcpServers,
  McpConfigError,
  readMcpConfig,
  writeHermesFusionMcp,
  writeMcpConfig,
} from "../mcp/install.js";

const LANGFUSE_MCP_PKG = process.env.FUSION_LANGFUSE_MCP || "langfuse-observability-mcp-server";

/** Phase 4 — `fusion mcp` (run the server) + `fusion connect` (install into a client). */
export function registerMcpCommands(program: Command): void {
  program
    .command("mcp")
    .description("Run Fusion's MCP server over stdio (or --langfuse to proxy Langfuse MCP with keys from config.toml)")
    .option("--langfuse", "Spawn the Langfuse MCP using keys from Fusion config (nothing written to editor JSON)")
    .action(async (opts: Record<string, unknown>) => {
      if (opts.langfuse) {
        const cfg = loadConfig();
        const { target } = await ensureLangfuse(cfg);
        if (!target?.publicKey) {
          console.error("No Langfuse host+keys. Run `fusion init` so Fusion can find your instance.");
          process.exit(1);
        }
        const code = await spawnExit("npx", ["-y", LANGFUSE_MCP_PKG], {
          stdio: "inherit",
          env: {
            ...filteredSpawnEnv(),
            LANGFUSE_HOST: target.host,
            LANGFUSE_PUBLIC_KEY: target.publicKey,
            LANGFUSE_SECRET_KEY: target.secretKey,
          },
          timeoutMs: NPX_MCP_TIMEOUT_MS,
        });
        process.exit(code);
      }
      const server = buildMcpServer();
      await server.connect(new StdioServerTransport());
    });

  program
    .command("connect <client>")
    .description("Install Fusion MCP into a client (cursor | hermes | claude-code | generic). Keys stay in Fusion config.")
    .option("--config <path>", "MCP config JSON to write (for `generic`)")
    .action(async (client: string, opts: Record<string, unknown>) => {
      if (client === "claude-code") {
        console.log("For Claude Code, register the servers with its CLI:");
        console.log(`  claude mcp add fusion -- fusion mcp`);
        console.log(`  claude mcp add langfuse -- fusion mcp --langfuse`);
        console.log(`(Langfuse MCP package: ${LANGFUSE_MCP_PKG} — override with $FUSION_LANGFUSE_MCP)`);
        console.log("Keys are read from Fusion config, not pasted into Claude's MCP entry.");
        return;
      }

      if (client === "hermes") {
        const { created } = initConfig();
        if (created) {
          console.log("Created a starter Fusion config. Run `fusion init` (TTY) or `fusion init --sink …` to pick Docker / cloud / gateway-only.");
        }
        const org = ensureOrgScopedKeys(loadConfig());
        if (!org.ok) {
          console.error(org.message);
          process.exit(1);
        }
        try {
          const backup = writeHermesFusionMcp();
          if (backup) console.log(`Backed up Hermes config → ${backup}`);
        } catch (err) {
          console.error(err instanceof McpConfigError ? err.message : String(err));
          process.exit(1);
        }
        console.log(`Wrote Fusion MCP into ${hermesConfigPath()} (no Langfuse secrets). ${org.message} Quit Hermes Desktop, reopen, start a new session.`);
        return;
      }

      const { created } = initConfig();
      if (created) {
        console.log("Created a starter Fusion config. Run `fusion init` (TTY) or `fusion init --sink …` to pick Docker / cloud / gateway-only.");
      }
      const cfg = loadConfig();
      const org = ensureOrgScopedKeys(cfg);
      if (!org.ok) {
        console.error(org.message);
        process.exit(1);
      }
      const { target } = await ensureLangfuse(cfg);
      if (!target) {
        console.error("No Langfuse found. Run `fusion init` first.");
        process.exit(1);
      }

      const path = client === "generic" ? (opts.config as string | undefined) : client === "cursor" ? cursorMcpPath() : null;
      if (!path) {
        console.error(`Unknown client "${client}". Use: cursor | hermes | claude-code | generic (with --config).`);
        process.exit(1);
      }
      if (client === "generic" && !opts.config) {
        console.error("`fusion connect generic` needs --config <path>.");
        process.exit(1);
      }

      let existing: Record<string, unknown>;
      try {
        existing = readMcpConfig(path);
      } catch (err) {
        console.error(err instanceof McpConfigError ? err.message : String(err));
        process.exit(1);
      }

      const merged = mergeMcpServers(existing, fusionMcpServers());
      const backup = writeMcpConfig(path, merged);
      if (backup) console.log(`Backed up ${path} → ${backup}`);
      console.log(`Installed fusion + langfuse MCP servers into ${path} (no Langfuse secret in that file).`);
      console.log(`Langfuse host ${target.host}; ${org.message} Keys stay in Fusion config. Restart the client.`);
    });
}
