import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/mcp/server.ts";
import { fusionMcpIcons, fusionMcpServerInfo, FUSION_MCP_WEBSITE } from "../src/mcp/identity.ts";

test("Fusion MCP initialize advertises title, website, and icons", async () => {
  const info = fusionMcpServerInfo();
  assert.equal(info.name, "fusion");
  assert.equal(info.title, "Fusion");
  assert.equal(info.websiteUrl, FUSION_MCP_WEBSITE);
  assert.ok(info.icons.length >= 2);
  assert.ok(info.icons.every((i) => i.src.startsWith("data:") || i.src.startsWith("https://")));
  assert.ok(fusionMcpIcons().some((i) => i.mimeType === "image/svg+xml"));
  assert.ok(fusionMcpIcons().some((i) => i.mimeType === "image/png"));

  const server = buildMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "fusion-identity-test", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    const version = client.getServerVersion();
    assert.ok(version);
    assert.equal(version.name, "fusion");
    assert.equal(version.title, "Fusion");
    assert.equal(version.websiteUrl, FUSION_MCP_WEBSITE);
    assert.ok(Array.isArray(version.icons) && version.icons.length > 0);
    assert.match(String(version.icons[0]?.src), /^(data:image\/|https:\/\/)/);

    const listed = await client.listTools();
    const status = listed.tools.find((t) => t.name === "fusion_status");
    assert.ok(status);
    const meta = status._meta as { icons?: Array<{ src?: string }> } | undefined;
    assert.ok(meta?.icons && meta.icons.length > 0);
    const icons = (status as { icons?: Array<{ src?: string }> }).icons;
    assert.ok(icons && icons.length > 0);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});
