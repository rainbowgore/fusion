import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig, activeTarget } from "../config/load.js";
import { runHealthChecks } from "../health.js";
import { buildCoverage } from "../engine/coverage.js";
import { LangfuseClient } from "../langfuse/client.js";
import { govTargetAdd, govTargetSetKeys, govProjectLink, govPricesSync, govEnableSource, govSetActive } from "../core/govern.js";
import { langfusePicture } from "./picture.js";
import { discoverLangfuse, publicDiscovery } from "../langfuse/discover.js";
import { fusionMcpIcons, fusionMcpServerInfo } from "./identity.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function brandMeta(): { icons: ReturnType<typeof fusionMcpIcons> } {
  return { icons: fusionMcpIcons() };
}

/**
 * Fusion's MCP server — operate + govern the control plane from inside any MCP
 * client (Cursor, Hermes, …). Every tool reuses the same core functions the CLI
 * uses, so CLI and in-client behavior can't diverge.
 *
 * Identity (title, website, icons) is advertised on initialize so clients that
 * render server marks can show the Fusion glyph instead of a generic MCP mark.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer(fusionMcpServerInfo());

  server.registerTool(
    "fusion_status",
    {
      title: "Fusion status",
      description: "Health of the Fusion control plane (core daemon, gateway, bridge, targets, prices).",
      _meta: brandMeta(),
    },
    async () => {
      const checks = await runHealthChecks(false);
      return text(checks.map((c) => `${c.status.toUpperCase().padEnd(4)} ${c.name}: ${c.detail}`).join("\n"));
    },
  );

  server.registerTool(
    "fusion_coverage",
    {
      title: "Fusion coverage",
      description: "Capture coverage + routing. Status unknown means Langfuse could not be queried (not “no activity”). Map is directory→project.",
      _meta: brandMeta(),
    },
    async () => text(JSON.stringify(await buildCoverage(loadConfig()), null, 2)),
  );

  server.registerTool(
    "fusion_targets_list",
    {
      title: "Fusion targets",
      description:
        "Langfuse Fusion can see: saved targets plus instances discovered from Docker, MCP config, env, and local health. Lists projects when keys work. Answer from `summary` and `discovered`.",
      _meta: brandMeta(),
    },
    async () => {
      const cfg = loadConfig();
      const discovered = publicDiscovery(await discoverLangfuse(cfg));
      return text(JSON.stringify({ ...langfusePicture(cfg), discovered }, null, 2));
    },
  );

  server.registerTool(
    "fusion_routes_list",
    {
      title: "Fusion routes",
      description: "Directory→project stamps Fusion writes. Empty means Fusion has not linked folders yet — not that Langfuse Cloud has no projects.",
      _meta: brandMeta(),
    },
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

  // --------------------------------------------------------------------------------------
  // Write / Govern Tools
  // --------------------------------------------------------------------------------------
  server.registerTool(
    "fusion_project_link",
    {
      title: "Link project",
      description: "Govern a directory: bind it to a project (and optional target). Writes a .fusion pointer + registers the route.",
      inputSchema: { dir: z.string().describe("Directory to link (absolute or relative)"), project: z.string(), target: z.string().optional() },
      _meta: brandMeta(),
    },
    async (a) => text(govProjectLink(a).message),
  );

  server.registerTool(
    "fusion_target_add",
    {
      title: "Add target",
      description: "Save a Langfuse target (cloud or local) after a live key check. Use when Fusion has no cloud target and the user wants Fusion pointed at Cloud.",
      inputSchema: {
        name: z.string(),
        host: z.string(),
        publicKey: z.string(),
        secretKey: z.string(),
        kind: z.enum(["local", "cloud"]).optional(),
        project: z.string().optional(),
        use: z.boolean().optional(),
      },
      _meta: brandMeta(),
    },
    async (a) => text((await govTargetAdd(a)).message),
  );

  server.registerTool(
    "fusion_target_set_keys",
    {
      title: "Set target keys",
      description: "Set/replace a target's Langfuse keys (validated live).",
      inputSchema: { name: z.string(), publicKey: z.string(), secretKey: z.string() },
      _meta: brandMeta(),
    },
    async (a) => text((await govTargetSetKeys(a)).message),
  );

  server.registerTool(
    "fusion_set_active",
    {
      title: "Set active target",
      description: "Switch the active target.",
      inputSchema: { name: z.string() },
      _meta: brandMeta(),
    },
    async (a) => text(govSetActive(a).message),
  );

  server.registerTool(
    "fusion_enable_source",
    {
      title: "Enable source",
      description: "Enable a client's capture: claude-code | codex | hermes.",
      inputSchema: { source: z.enum(["claude-code", "codex", "hermes"]), logPrompts: z.boolean().optional() },
      _meta: brandMeta(),
    },
    async (a) => text(govEnableSource(a).message),
  );

  server.registerTool(
    "fusion_prices_sync",
    {
      title: "Sync prices",
      description: "Register Fusion's model-price set on the active target so Langfuse computes cost.",
      _meta: brandMeta(),
    },
    async () => text((await govPricesSync()).message),
  );

  server.registerTool(
    "fusion_target_test",
    {
      title: "Test target",
      description: "Validate connectivity + auth to a target (or the active one) via a live Langfuse call.",
      inputSchema: { name: z.string().optional() },
      _meta: brandMeta(),
    },
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
