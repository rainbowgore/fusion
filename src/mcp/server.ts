import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, activeTarget } from "../config/load.js";
import { runHealthChecks } from "../health.js";
import { buildCoverage } from "../engine/coverage.js";
import { LangfuseClient } from "../langfuse/client.js";
import { govTargetAdd, govTargetSetKeys, govProjectLink, govPricesSync, govEnableSource, govSetActive } from "../core/govern.js";
import { langfusePicture } from "./picture.js";
import { discoverLangfuse, publicDiscovery } from "../langfuse/discover.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function fusionMcpIcons(): Array<{ src: string; mimeType: string; sizes: string[] }> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const svgPath = join(root, "assets", "mcp-icon.svg");
  if (!existsSync(svgPath)) return [];
  const b64 = readFileSync(svgPath).toString("base64");
  return [{ src: `data:image/svg+xml;base64,${b64}`, mimeType: "image/svg+xml", sizes: ["512x512"] }];
}

/**
 * Fusion's MCP server — operate + govern the control plane from inside any MCP
 * client (Cursor, Hermes, …). Every tool reuses the same core functions the CLI
 * uses, so CLI and in-client behavior can't diverge.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "fusion",
    title: "Fusion",
    version: "0.0.0",
    description: "Govern capture and routing into Langfuse from this machine.",
    icons: fusionMcpIcons(),
  });

  server.tool(
    "fusion_status",
    "Health of the Fusion control plane (core daemon, gateway, bridge, targets, prices).",
    {},
    async () => {
      const checks = await runHealthChecks(false);
      return text(checks.map((c) => `${c.status.toUpperCase().padEnd(4)} ${c.name}: ${c.detail}`).join("\n"));
    },
  );

  server.tool(
    "fusion_coverage",
    "Capture coverage + routing. Status unknown means Langfuse could not be queried (not “no activity”). Map is directory→project.",
    {},
    async () => text(JSON.stringify(await buildCoverage(loadConfig()), null, 2)),
  );

  server.tool(
    "fusion_targets_list",
    "Langfuse Fusion can see: saved targets plus instances discovered from Docker, MCP config, env, and local health. Lists projects when keys work. Answer from `summary` and `discovered`.",
    {},
    async () => {
      const cfg = loadConfig();
      const discovered = publicDiscovery(await discoverLangfuse(cfg));
      return text(JSON.stringify({ ...langfusePicture(cfg), discovered }, null, 2));
    },
  );

  server.tool(
    "fusion_routes_list",
    "Directory→project stamps Fusion writes. Empty means Fusion has not linked folders yet — not that Langfuse Cloud has no projects.",
    {},
    async () => {
      const cfg = loadConfig();
      return text(
        JSON.stringify(
          {
            summary:
              cfg.links.length === 0
                ? "No Fusion directory routes. Langfuse Cloud projects are not listed here."
                : `${cfg.links.length} directory route(s).`,
            links: cfg.links,
          },
          null,
          2,
        ),
      );
    },
  );

  // ---- Write / govern tools (same core the CLI + /control use) ----
  server.tool(
    "fusion_project_link",
    "Govern a directory: bind it to a project (and optional target). Writes a .fusion pointer + registers the route.",
    { dir: z.string().describe("Directory to link (absolute or relative)"), project: z.string(), target: z.string().optional() },
    async (a) => text(govProjectLink(a).message),
  );

  server.tool(
    "fusion_target_add",
    "Save a Langfuse target (cloud or local) after a live key check. Use when Fusion has no cloud target and the user wants Fusion pointed at Cloud.",
    { name: z.string(), host: z.string(), publicKey: z.string(), secretKey: z.string(), kind: z.enum(["local", "cloud"]).optional(), project: z.string().optional(), use: z.boolean().optional() },
    async (a) => text((await govTargetAdd(a)).message),
  );

  server.tool(
    "fusion_target_set_keys",
    "Set/replace a target's Langfuse keys (validated live).",
    { name: z.string(), publicKey: z.string(), secretKey: z.string() },
    async (a) => text((await govTargetSetKeys(a)).message),
  );

  server.tool(
    "fusion_set_active",
    "Switch the active target.",
    { name: z.string() },
    async (a) => text(govSetActive(a).message),
  );

  server.tool(
    "fusion_enable_source",
    "Enable a client's capture: claude-code | codex | hermes.",
    { source: z.enum(["claude-code", "codex", "hermes"]), logPrompts: z.boolean().optional() },
    async (a) => text(govEnableSource(a).message),
  );

  server.tool(
    "fusion_prices_sync",
    "Register Fusion's model-price set on the active target so Langfuse computes cost.",
    {},
    async () => text((await govPricesSync()).message),
  );

  server.tool(
    "fusion_target_test",
    "Validate connectivity + auth to a target (or the active one) via a live Langfuse call.",
    { name: z.string().optional() },
    async ({ name }) => {
      const cfg = loadConfig();
      const target = name ? cfg.targets.find((t) => t.name === name) : activeTarget(cfg);
      if (!target) return text(`Error: no target named "${name}".`);
      const v = await new LangfuseClient(target).validate();
      return text(`${v.ok ? "OK" : "FAIL"} — ${v.message}`);
    },
  );

  return server;
}
