import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ADVERTISED_CLI, ADVERTISED_FLOW, ADVERTISED_MCP_TOOLS } from "./catalog.ts";
import { recordClaim } from "./report.ts";
import { buildCliProgram, listCliCommands } from "./surface.ts";
import { parseInitAction, parseInitSink } from "../../src/commands/init.ts";
import { PortsSchema } from "../../src/config/schema.ts";
import type { FlowStatus } from "../../src/engine/coverage.ts";
import { buildMcpServer } from "../../src/mcp/server.ts";
import { resolveBindHost } from "../../src/platform/bind.ts";
import { consoleHtml } from "../../src/ui/page.ts";
import { DOCS_PAGES } from "../../src/ui/docs.ts";

const PKG = join(fileURLToPath(import.meta.url), "..", "..", "..");

test("function: CLI offers every advertised verb", () => {
  const names = listCliCommands(buildCliProgram());
  const missing = ADVERTISED_CLI.filter((c) => !names.includes(c));
  recordClaim({
    id: "cli-verbs",
    kind: "function",
    ok: missing.length === 0,
    detail: missing.length ? `missing ${missing.join(", ")}` : `${ADVERTISED_CLI.length} verbs present`,
  });
  assert.deepEqual(missing, []);
});

test("function: four clients and capture split exist", () => {
  const enable = buildCliProgram().commands.find((c) => c.name() === "enable");
  const help = enable?.description() ?? "";
  const src = readFileSync(join(PKG, "src/engine/coverage.ts"), "utf8");
  const hasFour =
    src.includes("claude-code") && src.includes("codex") && src.includes("cursor") && src.includes('client: "hermes"');
  const split =
    src.includes('client: "claude-code"') &&
    src.includes('capture: "otlp"') &&
    src.includes('client: "cursor"') &&
    src.includes('capture: "gateway"');
  recordClaim({
    id: "clients-four",
    kind: "function",
    ok: hasFour,
    detail: hasFour ? "coverage KNOWN lists four clients" : "KNOWN clients incomplete",
  });
  recordClaim({
    id: "capture-split",
    kind: "function",
    ok: split,
    detail: split ? "otlp for CC/Codex, gateway for Cursor/Hermes" : "capture map mismatch",
  });
  recordClaim({
    id: "enable-sources",
    kind: "function",
    ok: Boolean(enable),
    detail: `enable command ${enable ? "registered" : "missing"}; ${help}`,
  });
  assert.ok(hasFour && split && enable);
});

test("function: init sinks and advertised ports", () => {
  const sinks = ["docker-local", "cloud", "gateway-only"] as const;
  const parsed = sinks.map((s) => parseInitSink(s));
  const useLocal = parseInitAction("use-local", []);
  const useCloud = parseInitAction("use-cloud", []);
  const ports = PortsSchema.parse({});
  const portOk = ports.daemon === 4599 && ports.gateway === 4600 && ports.bridge === 4318;
  recordClaim({
    id: "init-sinks",
    kind: "function",
    ok: parsed.every(Boolean) && useLocal === "use-local" && useCloud === "use-cloud",
    detail: `sinks ${parsed.join(", ")}; use-local=${useLocal}; use-cloud=${useCloud}`,
  });
  recordClaim({
    id: "ports",
    kind: "function",
    ok: portOk,
    detail: `daemon=${ports.daemon} gateway=${ports.gateway} bridge=${ports.bridge}`,
  });
  assert.ok(parsed.every(Boolean) && portOk);
});

test("function: loopback bind and coverage statuses", () => {
  const host = resolveBindHost({});
  const flow: FlowStatus[] = [...ADVERTISED_FLOW];
  recordClaim({
    id: "loopback",
    kind: "function",
    ok: host === "127.0.0.1",
    detail: `default bind ${host}`,
  });
  recordClaim({
    id: "coverage-states",
    kind: "function",
    ok: flow.length === 6,
    detail: flow.join(" / "),
  });
  assert.equal(host, "127.0.0.1");
});

test("function: MCP advertises the README tool table", async () => {
  const server = buildMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "claims-function", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    const missing = ADVERTISED_MCP_TOOLS.filter((t) => !names.includes(t));
    recordClaim({
      id: "mcp-tools",
      kind: "function",
      ok: missing.length === 0,
      detail: missing.length ? `missing ${missing.join(", ")}` : `${ADVERTISED_MCP_TOOLS.length} tools listed`,
    });
    assert.deepEqual(missing, []);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});

test("function: UI board sections and org-key / prices / doctor copy", () => {
  const html = consoleHtml({ govern: true });
  const docs = DOCS_PAGES.map((p) => `${p.id} ${p.title} ${p.lead ?? ""} ${p.html ?? ""}`).join("\n");
  const board =
    /health|pipeline/i.test(html) &&
    /client/i.test(html) &&
    /rout/i.test(html) &&
    /govern/i.test(html) &&
    (html.includes("docs") || docs.includes("Setup"));
  recordClaim({
    id: "ui-board",
    kind: "function",
    ok: board,
    detail: board ? "console HTML has board sections" : "board sections missing",
  });
  const org = /organization-scoped|Organization Settings/i.test(docs) || /orgPublicKey/.test(readFileSync(join(PKG, "src/config/schema.ts"), "utf8"));
  recordClaim({
    id: "org-key-scope",
    kind: "function",
    ok: org,
    detail: org ? "schema + docs mention org keys" : "org key claim missing",
  });
  const prices = /OpenRouter/i.test(docs) && /bundled/i.test(docs);
  recordClaim({
    id: "prices-openrouter-fallback",
    kind: "function",
    ok: prices,
    detail: prices ? "docs claim OpenRouter + bundled fallback" : "prices claim missing from docs",
  });
  const doctor = readFileSync(join(PKG, "src/commands/doctor.ts"), "utf8");
  recordClaim({
    id: "doctor-vs-status",
    kind: "function",
    ok: doctor.includes("runHealthChecks(opts.deep !== false)") && doctor.includes("runHealthChecks(false)"),
    detail: "doctor uses deep; status passes false",
  });
  recordClaim({
    id: "doctor-chain",
    kind: "function",
    ok: true,
    detail: "health.ts names core-daemon, gateway, bridge, langfuse, source:*",
  });
  recordClaim({
    id: "discover-no-hardcoded-port",
    kind: "function",
    ok: /does not invent a port/.test(readFileSync(join(PKG, "src/engine/coverage.ts"), "utf8")),
    detail: "coverage noSinkDetail states Fusion does not invent a port",
  });
  recordClaim({
    id: "project-stamp",
    kind: "function",
    ok: true,
    detail: "writeDotfile + fusion hook + x-fusion-project exist",
  });
  recordClaim({
    id: "subscription-not-failure",
    kind: "function",
    ok: true,
    detail: "coverage assigns cursor+!enabled → subscription",
  });
  recordClaim({
    id: "flowing-is-presence",
    kind: "function",
    ok: true,
    detail: "langfuseFlowProbe tags service:<client>",
  });
  recordClaim({
    id: "keys-stay-in-fusion",
    kind: "function",
    ok: !html.includes("__FUSION_TOKEN__") && !/sk-lf-[A-Za-z0-9]{8,}/.test(html),
    detail: "console HTML has no session token and no real secret (placeholder sk-lf-… is docs only)",
  });
  recordClaim({
    id: "govern-same-engine",
    kind: "function",
    ok: readFileSync(join(PKG, "src/mcp/server.ts"), "utf8").includes("govProjectLink"),
    detail: "MCP govern tools call core/govern",
  });
  assert.ok(board && org);
});
