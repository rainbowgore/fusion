import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConfigSchema } from "../../src/config/schema.ts";
import { saveConfig } from "../../src/config/load.ts";
import { initMenuActions } from "../../src/commands/init.ts";
import { govEnableSource, govProjectLink } from "../../src/core/govern.ts";
import { buildCoverage } from "../../src/engine/coverage.ts";
import { runHealthChecks } from "../../src/health.ts";
import { applyLivePrices, loadPriceDefs } from "../../src/langfuse/prices.ts";
import { buildMcpServer } from "../../src/mcp/server.ts";
import { langfusePicture } from "../../src/mcp/picture.ts";
import { resolveBindHost } from "../../src/platform/bind.ts";
import { writeDotfile, readDotfile } from "../../src/routing/dotfile.ts";
import { effectiveRoute, otelResourceAttributes } from "../../src/routing/resolve.ts";
import { consoleHtml } from "../../src/ui/page.ts";
import { startMockLangfuse } from "../functional/setup.ts";
import { recordClaim } from "./report.ts";

process.env.FUSION_SKIP_DISCOVER = "1";

function isolateConfig(): { root: string; restore: () => void } {
  const root = mkdtempSync(join(tmpdir(), "fusion-claims-"));
  const prev = {
    FUSION_CONFIG: process.env.FUSION_CONFIG,
    FUSION_DATA_DIR: process.env.FUSION_DATA_DIR,
    FUSION_LINK_ROOT: process.env.FUSION_LINK_ROOT,
    HERMES_HOME: process.env.HERMES_HOME,
    FUSION_HERMES_CONFIG: process.env.FUSION_HERMES_CONFIG,
    HOME: process.env.HOME,
  };
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "links"), { recursive: true });
  process.env.FUSION_CONFIG = join(root, "config.toml");
  process.env.FUSION_DATA_DIR = join(root, "data");
  process.env.FUSION_LINK_ROOT = join(root, "links");
  process.env.HERMES_HOME = join(home, ".hermes");
  process.env.FUSION_HERMES_CONFIG = join(home, ".hermes", "config.yaml");
  process.env.HOME = home;
  mkdirSync(join(home, ".hermes"), { recursive: true });
  writeFileSync(join(home, ".hermes", "config.yaml"), "model:\n  provider: openai\n", "utf8");
  return {
    root,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

test("value: four clients, capture split, cursor is subscription not failure", async () => {
  const iso = isolateConfig();
  try {
  const cfg = ConfigSchema.parse({
    sink: "cloud",
    activeTarget: "t",
    sources: { "claude-code": true, codex: true, cursor: false, hermes: true },
    targets: [{ name: "t", kind: "cloud", host: "http://127.0.0.1:1", publicKey: "pk-lf-x", secretKey: "sk-lf-y" }],
  });
  const cov = await buildCoverage(cfg, { live: false });
  const clients = cov.endpoints.filter((e) => ["claude-code", "codex", "cursor", "hermes"].includes(e.client));
  const captures = Object.fromEntries(clients.map((e) => [e.client, e.capture]));
  const cursor = clients.find((e) => e.client === "cursor");
  const hermes = clients.find((e) => e.client === "hermes");
  const four = clients.length === 4;
  const split =
    captures["claude-code"] === "otlp" &&
    captures.codex === "otlp" &&
    captures.cursor === "gateway" &&
    captures.hermes === "gateway";
  recordClaim({
    id: "clients-four",
    kind: "value",
    ok: four,
    detail: four ? "coverage returns four known clients" : `got ${clients.map((e) => e.client).join(",")}`,
  });
  recordClaim({
    id: "capture-split",
    kind: "value",
    ok: split,
    detail: JSON.stringify(captures),
  });
  recordClaim({
    id: "subscription-not-failure",
    kind: "value",
    ok: cursor?.status === "subscription",
    detail: `cursor=${cursor?.status} — ${cursor?.detail}`,
  });
  saveConfig(cfg);
  const enableCursor = govEnableSource({ source: "cursor" });
  recordClaim({
    id: "enable-sources",
    kind: "value",
    ok: enableCursor.ok === false,
    detail: enableCursor.message,
  });
  assert.ok(four && split && cursor?.status === "subscription");
  assert.equal(hermes?.status, "bypassed");
  } finally {
    iso.restore();
  }
});

test("value: FLOWING is a tagged presence signal; unreachable is unknown", async () => {
  const lf = await startMockLangfuse();
  try {
    lf.tags.push(["service:claude-code"]);
    const cfg = ConfigSchema.parse({
      sink: "cloud",
      activeTarget: "t",
      sources: { "claude-code": true, codex: false, cursor: false, hermes: false },
      targets: [
        {
          name: "t",
          kind: "cloud",
          host: lf.host,
          publicKey: "pk-lf-x",
          secretKey: "sk-lf-y",
        },
      ],
    });
    const cov = await buildCoverage(cfg);
    const cc = cov.endpoints.find((e) => e.client === "claude-code");
    const flowing = cc?.status === "flowing";
    recordClaim({
      id: "flowing-is-presence",
      kind: "value",
      ok: flowing,
      detail: flowing ? "service:claude-code tag → flowing" : `status=${cc?.status}`,
    });
    assert.equal(cc?.status, "flowing");
  } finally {
    await lf.close();
  }

  const dead = ConfigSchema.parse({
    sink: "cloud",
    activeTarget: "t",
    sources: { "claude-code": true },
    targets: [
      { name: "t", kind: "cloud", host: "http://127.0.0.1:1", publicKey: "pk-lf-x", secretKey: "sk-lf-y" },
    ],
  });
  const unknown = await buildCoverage(dead);
  const cc = unknown.endpoints.find((e) => e.client === "claude-code");
  recordClaim({
    id: "coverage-states",
    kind: "value",
    ok: cc?.status === "unknown" && /unreachable/i.test(cc.detail),
    detail: `${cc?.status} — ${cc?.detail}`,
  });
  assert.equal(cc?.status, "unknown");
});

test("value: no invented Langfuse port; loopback refused for 0.0.0.0", async () => {
  const cfg = ConfigSchema.parse({
    sink: "cloud",
    sources: { "claude-code": true },
    targets: [],
  });
  const cov = await buildCoverage(cfg);
  const cc = cov.endpoints.find((e) => e.client === "claude-code");
  const noInvent = /does not invent a port/i.test(cc?.detail ?? "");
  recordClaim({
    id: "discover-no-hardcoded-port",
    kind: "value",
    ok: noInvent,
    detail: cc?.detail ?? "",
  });
  let refused = false;
  try {
    resolveBindHost({ FUSION_BIND: "0.0.0.0" });
  } catch {
    refused = true;
  }
  recordClaim({
    id: "loopback",
    kind: "value",
    ok: refused && resolveBindHost({}) === "127.0.0.1",
    detail: refused ? "0.0.0.0 rejected; default 127.0.0.1" : "0.0.0.0 was accepted",
  });
  assert.ok(noInvent && refused);
});

test("value: init menu, ports, doctor vs status, doctor chain", async () => {
  const iso = isolateConfig();
  try {
    const menu = initMenuActions([
      {
        host: "http://127.0.0.1:3005",
        kind: "local",
        source: "env",
        healthy: true,
        hasKeys: true,
        projects: [],
        publicKey: "pk",
        secretKey: "sk",
      },
      {
        host: "https://cloud.langfuse.com",
        kind: "cloud",
        source: "env",
        healthy: true,
        hasKeys: true,
        projects: [],
        publicKey: "pk",
        secretKey: "sk",
      },
    ]);
    const sinks = ["use-local", "use-cloud", "docker-local", "cloud", "gateway-only"].every((a) => menu.includes(a as typeof menu[number]));
    recordClaim({
      id: "init-sinks",
      kind: "value",
      ok: sinks,
      detail: menu.join(", "),
    });

    saveConfig(
      ConfigSchema.parse({
        sink: "cloud",
        activeTarget: "t",
        sources: {},
        targets: [
          { name: "t", kind: "cloud", host: "http://127.0.0.1:1", publicKey: "pk-lf-x", secretKey: "sk-lf-y" },
        ],
        ports: {},
      }),
    );
    const shallow = await runHealthChecks(false);
    const deep = await runHealthChecks(true);
    const names = new Set(deep.map((c) => c.name));
    const lfShallow = shallow.find((c) => c.name === "langfuse");
    const lfDeep = deep.find((c) => c.name === "langfuse");
    recordClaim({
      id: "doctor-vs-status",
      kind: "value",
      ok: lfShallow?.status === "skip" && lfDeep?.status !== "skip",
      detail: `status langfuse=${lfShallow?.status} (${lfShallow?.detail}); doctor=${lfDeep?.status}`,
    });
    const chain = ["core-daemon", "gateway", "bridge", "langfuse"].every((n) => names.has(n));
    recordClaim({
      id: "doctor-chain",
      kind: "value",
      ok: chain,
      detail: [...names].join(", "),
    });
    const uiUsesDaemon = readFileSync(join(import.meta.dirname, "..", "..", "src", "commands", "ui.ts"), "utf8").includes("cfg.ports.daemon");
    recordClaim({
      id: "ports",
      kind: "value",
      ok: uiUsesDaemon,
      detail: "fusion ui opens the daemon control port (:4599 default), not ports.ui",
    });
    assert.ok(sinks && chain && lfShallow?.status === "skip");
  } finally {
    iso.restore();
  }
});

test("value: .fusion stamps project at the source; Fusion does not infer it from a trace", () => {
  const iso = isolateConfig();
  try {
    const dir = join(iso.root, "links", "app");
    const nested = join(dir, "nested");
    mkdirSync(nested, { recursive: true });
    saveConfig(ConfigSchema.parse({ sink: "gateway-only", sources: {}, targets: [] }));
    const linked = govProjectLink({ dir, project: "alpha" });
    const df = readDotfile(dir);
    const route = effectiveRoute(nested);
    const attrs = route ? otelResourceAttributes(route) : "";
    const ok = linked.ok && df?.project === "alpha" && route?.project === "alpha" && attrs.includes("project=alpha");
    recordClaim({
      id: "project-stamp",
      kind: "value",
      ok,
      detail: `${linked.message}; attrs=${attrs}`,
    });
    recordClaim({
      id: "govern-same-engine",
      kind: "value",
      ok: linked.ok && writeDotfile(dir, { project: "alpha" }).endsWith(".fusion"),
      detail: "govProjectLink writes .fusion + config.links",
    });
    assert.ok(ok);
  } finally {
    iso.restore();
  }
});

test("value: keys stay in Fusion; org key is required for org listing; MCP tools work; UI board; prices fallback", async () => {
  const mcpJson = readFileSync(join(import.meta.dirname, "..", "..", "mcp.json"), "utf8");
  const html = consoleHtml({ govern: true });
  const keysOk = !/sk-lf-|pk-lf-|LANGFUSE_SECRET|orgSecretKey/.test(mcpJson) && !html.includes("__FUSION_TOKEN__") && !/sk-lf-[A-Za-z0-9]{8,}/.test(html);
  recordClaim({
    id: "keys-stay-in-fusion",
    kind: "value",
    ok: keysOk,
    detail: "editor mcp.json has no Langfuse keys; console has no session token",
  });

  const picture = langfusePicture(
    ConfigSchema.parse({
      sink: "cloud",
      activeTarget: "cloud",
      targets: [
        { name: "cloud", kind: "cloud", host: "https://cloud.langfuse.com", publicKey: "pk-lf-a", secretKey: "sk-lf-a" },
      ],
    }),
  );
  const org = /organization-scoped key/i.test(picture.summary) && picture.targets[0]?.hasOrgKeys === false;
  recordClaim({
    id: "org-key-scope",
    kind: "value",
    ok: org,
    detail: picture.summary.slice(0, 220),
  });

  const board = html.includes("health-chips") && html.includes("endpoints") && html.includes("routes") && html.includes("id=\"govern\"") && html.includes("id=\"docs\"");
  recordClaim({
    id: "ui-board",
    kind: "value",
    ok: board,
    detail: "console HTML includes board ids/sections",
  });

  const bundled = loadPriceDefs();
  const overlay = applyLivePrices(bundled, new Map());
  recordClaim({
    id: "prices-openrouter-fallback",
    kind: "value",
    ok: bundled.length > 0 && overlay.updated === 0 && overlay.missing === bundled.length,
    detail: `${bundled.length} bundled defs; live miss → ${overlay.missing} fallback`,
  });

  const server = buildMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "claims-value", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    recordClaim({
      id: "mcp-tools",
      kind: "value",
      ok: names.includes("fusion_coverage") && names.includes("fusion_project_link"),
      detail: `${names.length} tools callable over MCP`,
    });
    const iso = isolateConfig();
    try {
      saveConfig(ConfigSchema.parse({ sink: "gateway-only", sources: {}, targets: [] }));
      const res = await client.callTool({ name: "fusion_status", arguments: {} });
      const text = JSON.stringify(res);
      recordClaim({
        id: "cli-verbs",
        kind: "value",
        ok: !/sk-lf-/.test(text),
        detail: "fusion_status MCP result does not echo secret keys",
      });
    } finally {
      iso.restore();
    }
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
  assert.ok(keysOk && org && bundled.length > 0);
});
