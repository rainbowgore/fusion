import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../src/config/load.ts";
import {
  appInstalled,
  callMcpToolInProcess,
  createFunctionalEnv,
  recordAction,
  recordSkip,
  withMcpClient,
} from "./setup.ts";

const READ_TOOLS = ["fusion_status", "fusion_coverage", "fusion_targets_list", "fusion_routes_list"] as const;
const WRITE_TOOLS = [
  "fusion_project_link",
  "fusion_target_add",
  "fusion_target_set_keys",
  "fusion_set_active",
  "fusion_enable_source",
  "fusion_prices_sync",
] as const;

test("functional MCP: all tools over stdio subprocess", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const proj = join(fx.linkRoot, "mcp-link");
    mkdirSync(proj, { recursive: true });

    await withMcpClient(fx.env, async (callTool) => {
      for (const name of READ_TOOLS) {
        const text = await callTool(name);
        assert.ok(text.length > 0, `${name} returned empty`);
        recordAction("mcp", `${name} (stdio)`);
      }

      const link = await callTool("fusion_project_link", { dir: proj, project: "mcp-proj" });
      assert.match(link, /Linked|project/i);
      assert.ok(existsSync(join(proj, ".fusion")));
      recordAction("mcp", "fusion_project_link (stdio)");

      const add = await callTool("fusion_target_add", {
        name: "mcp-extra",
        host: fx.lf.host,
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        kind: "cloud",
        use: false,
      });
      assert.match(add, /Added|exists|target/i);
      recordAction("mcp", "fusion_target_add (stdio)");

      const keys = await callTool("fusion_target_set_keys", {
        name: "mock",
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
      });
      assert.match(keys, /Keys set|OK|mock/i);
      recordAction("mcp", "fusion_target_set_keys (stdio)");

      const active = await callTool("fusion_set_active", { name: "mock" });
      assert.match(active, /Active target|mock/i);
      recordAction("mcp", "fusion_set_active (stdio)");

      const enable = await callTool("fusion_enable_source", { source: "claude-code" });
      assert.match(enable, /Claude Code|configured|Wrote/i);
      assert.ok(existsSync(join(fx.dataDir, "claude-code.env.sh")));
      recordAction("mcp", "fusion_enable_source claude-code (stdio)");

      const prices = await callTool("fusion_prices_sync");
      assert.ok(prices.length > 0);
      recordAction("mcp", "fusion_prices_sync (stdio)");

      const routes = await callTool("fusion_routes_list");
      assert.match(routes, /mcp-proj|directory route/i);
    });

    const cfg = loadConfig();
    assert.ok(cfg.links.some((l) => l.project === "mcp-proj"));
    assert.equal(cfg.sources["claude-code"], true);
  } finally {
    await fx.close();
  }
});

test("functional MCP: in-process fallback via buildMcpServer", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const text = await callMcpToolInProcess("fusion_status");
    assert.ok(text.length > 0);
    recordAction("mcp", "fusion_status (in-process fallback)");
  } finally {
    await fx.close();
  }
});

test("functional MCP: Cursor Desktop e2e gated", async (t) => {
  if (!appInstalled("Cursor")) {
    recordSkip("mcp", "cursor desktop fusion_status", "Cursor Desktop not installed");
    t.skip("Cursor Desktop not installed");
    return;
  }
  // Full Cursor agent automation is environment-specific; record presence and config install surface.
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const { runCli } = await import("./setup.ts");
    const r = await runCli(["connect", "cursor"], fx.env);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const mcp = JSON.parse(readFileSync(fx.cursorMcp, "utf8")) as { mcpServers?: { fusion?: unknown } };
    assert.ok(mcp.mcpServers?.fusion);
    recordAction("mcp", "cursor connect + fusion server present (desktop installed)");
    recordSkip("mcp", "cursor agent invoke fusion_status", "requires interactive Cursor agent session");
  } finally {
    await fx.close();
  }
});

// silence unused const warnings for documentation of full tool list
void WRITE_TOOLS;
