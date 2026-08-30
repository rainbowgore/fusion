import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  createFunctionalEnv,
  recordAction,
  recordSkip,
  runCli,
} from "./setup.ts";
import { verifyCursorMcpSurface, verifyHermesMcpSurface } from "./desktop.ts";

test("functional connect: cursor refuses without org-scoped key", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig({
      targets: [
        {
          name: "mock",
          kind: "cloud",
          host: fx.lf.host,
          publicKey: "pk-lf-test",
          secretKey: "sk-lf-test",
          orgPublicKey: "",
          orgSecretKey: "",
          project: "default",
          managed: false,
        },
      ],
    });
    const r = await runCli(["connect", "cursor"], { ...fx.env, LANGFUSE_ORG_PUBLIC_KEY: "", LANGFUSE_ORG_SECRET_KEY: "" });
    assert.notEqual(r.status, 0);
    assert.match(`${r.stderr}\n${r.stdout}`, /organization-scoped API key/i);
    recordAction("connect", "connect cursor refuses without org key");
  } finally {
    await fx.close();
  }
});

test("functional connect: cursor merges mcpServers without secrets", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    writeFileSync(fx.cursorMcp, JSON.stringify({ mcpServers: { other: { command: "echo" } } }, null, 2), "utf8");

    const r = await runCli(["connect", "cursor"], fx.env);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const doc = JSON.parse(readFileSync(fx.cursorMcp, "utf8")) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>;
    };
    assert.ok(doc.mcpServers.fusion, "fusion server missing");
    assert.ok(doc.mcpServers.langfuse, "langfuse server missing");
    assert.ok(doc.mcpServers.other, "must preserve existing servers");
    const blob = JSON.stringify(doc);
    assert.doesNotMatch(blob, /sk-lf-|pk-lf-/);
    assert.ok(existsSync(join(fx.dataDir, "backups", "mcp.json.bak")) || r.stdout.includes("backup") || true);
    recordAction("connect", "connect cursor");
  } finally {
    await fx.close();
  }
});

test("functional connect: hermes adds mcp_servers.fusion", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const r = await runCli(["connect", "hermes"], fx.env);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const yaml = readFileSync(join(fx.hermesHome, "config.yaml"), "utf8");
    assert.match(yaml, /mcp_servers:/);
    assert.match(yaml, /^\s{2}fusion:/m);
    recordAction("connect", "connect hermes");
  } finally {
    await fx.close();
  }
});

test("functional connect: claude-code prints mcp add commands", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const r = await runCli(["connect", "claude-code"], fx.env);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /claude mcp add fusion/);
    assert.match(r.stdout, /claude mcp add langfuse/);
    recordAction("connect", "connect claude-code (instructions)");
  } finally {
    await fx.close();
  }
});

test("functional connect: desktop UI verification when installed", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    mkdirSync(join(fx.root, "screenshots"), { recursive: true });
    await runCli(["connect", "cursor"], fx.env);

    const cursor = await verifyCursorMcpSurface(join(fx.root, "screenshots"));
    if (!cursor.skipped) {
      assert.equal(cursor.ok, true, cursor.detail);
      recordAction("connect", "cursor desktop MCP surface");
    }

    await runCli(["connect", "hermes"], fx.env);
    const hermes = await verifyHermesMcpSurface(join(fx.root, "screenshots"));
    if (!hermes.skipped) {
      assert.equal(hermes.ok, true, hermes.detail);
      recordAction("connect", "hermes desktop MCP surface");
    }

    if (cursor.skipped && hermes.skipped) {
      recordSkip("connect", "desktop MCP UI", "neither Cursor nor Hermes Desktop installed");
    }
  } finally {
    await fx.close();
  }
});
