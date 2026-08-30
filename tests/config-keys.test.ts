import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigSchema } from "../src/config/schema.ts";
import { ensureOrgScopedKeys, MCP_CONNECT_NEEDS_ORG_KEY, needsLangfuseKeys } from "../src/config/credentials.ts";
import {
  fusionMcpServers,
  mergeHermesFusionMcp,
  mergeMcpServers,
  parseMcpJson,
  stripHermesMcpServer,
  McpConfigError,
} from "../src/mcp/install.ts";
import { langfusePicture } from "../src/mcp/picture.ts";
import { filteredSpawnEnv } from "../src/platform/spawn-env.ts";

test("Zod ConfigSchema rejects colliding ports and unknown activeTarget", () => {
  const ok = ConfigSchema.safeParse({
    activeTarget: "cloud",
    targets: [{ name: "cloud", kind: "cloud", host: "https://cloud.langfuse.com", publicKey: "pk", secretKey: "sk" }],
    ports: { ui: 3006, bridge: 4318, langfuseWeb: 3000, daemon: 4599, gateway: 4600 },
  });
  assert.equal(ok.success, true);

  const collide = ConfigSchema.safeParse({
    ports: { ui: 4318, bridge: 4318, langfuseWeb: 3000, daemon: 4599, gateway: 4600 },
  });
  assert.equal(collide.success, false);

  const dangling = ConfigSchema.safeParse({
    activeTarget: "missing",
    targets: [{ name: "cloud", kind: "cloud", host: "https://cloud.langfuse.com" }],
  });
  assert.equal(dangling.success, false);
});

test("ensureOrgScopedKeys is required for Cursor/Hermes MCP connect", () => {
  const missing = ConfigSchema.parse({
    sink: "cloud",
    activeTarget: "t",
    targets: [{ name: "t", kind: "cloud", host: "https://cloud.langfuse.com", publicKey: "pk-lf-a", secretKey: "sk-lf-b" }],
  });
  const no = ensureOrgScopedKeys(missing, {});
  assert.equal(no.ok, false);
  assert.equal(no.message, MCP_CONNECT_NEEDS_ORG_KEY);

  const fromEnv = ConfigSchema.parse({
    sink: "cloud",
    activeTarget: "t",
    targets: [{ name: "t", kind: "cloud", host: "https://cloud.langfuse.com", publicKey: "pk-lf-a", secretKey: "sk-lf-b" }],
  });
  const yes = ensureOrgScopedKeys(
    fromEnv,
    {
      LANGFUSE_ORG_PUBLIC_KEY: "pk-lf-org-a",
      LANGFUSE_ORG_SECRET_KEY: "sk-lf-org-b",
    },
    { persist: false },
  );
  assert.equal(yes.ok, true);
  assert.equal(fromEnv.targets[0].orgPublicKey, "pk-lf-org-a");
});

test("needsLangfuseKeys is false for gateway-only and true for cloud without keys", () => {
  const base = ConfigSchema.parse({ sink: "cloud", activeTarget: "t", targets: [{ name: "t", kind: "cloud", host: "https://cloud.langfuse.com" }] });
  assert.equal(needsLangfuseKeys(base, base.targets[0]), true);
  const keyed = { ...base, targets: [{ ...base.targets[0], publicKey: "pk-lf-a", secretKey: "sk-lf-b" }] };
  assert.equal(needsLangfuseKeys(keyed, keyed.targets[0]), false);
  const gw = { ...base, sink: "gateway-only" as const };
  assert.equal(needsLangfuseKeys(gw, gw.targets[0]), false);
});

test("corrupt MCP JSON is not treated as empty", () => {
  assert.throws(() => parseMcpJson("{"), McpConfigError);
  const merged = mergeMcpServers({ mcpServers: { other: { command: "keep-me" } } }, fusionMcpServers());
  const servers = merged.mcpServers as Record<string, { command?: string; args?: string[] }>;
  assert.equal((servers.other as { command: string }).command, "keep-me");
  assert.ok(servers.fusion?.args?.includes("mcp"));
  assert.ok(servers.langfuse?.args?.includes("mcp"));
  assert.ok(servers.langfuse?.args?.includes("--langfuse"));
  assert.equal(JSON.stringify(merged).includes("sk-lf"), false);
  assert.equal(JSON.stringify(merged).includes("SECRET"), false);
});

test("Hermes YAML merge is idempotent and keeps other MCP servers", () => {
  const before = `mcp_servers:
  langfuse:
    url: https://cloud.langfuse.com/api/public/mcp
  fusion:
    command: old
    args:
      - leftover
`;
  const once = mergeHermesFusionMcp(before);
  const twice = mergeHermesFusionMcp(once);
  assert.equal(once, twice);
  assert.match(once, /command:/);
  assert.match(once, /enabled: true/);
  assert.match(once, /url: https:\/\/cloud\.langfuse\.com\/api\/public\/mcp/);
  assert.equal((once.match(/^  fusion:/gm) || []).length, 1);
  assert.ok(!stripHermesMcpServer(once, "fusion").includes("  fusion:"));
});

test("langfusePicture does not treat starter local stub as cloud", () => {
  const cfg = ConfigSchema.parse({
    sink: "gateway-only",
    activeTarget: "",
    targets: [],
    links: [],
  });
  const pic = langfusePicture(cfg);
  assert.match(pic.summary, /discovers Langfuse/i);
  assert.match(pic.summary, /not a list of Langfuse Cloud/i);
  assert.equal(pic.cloudProjects.length, 0);
  assert.equal(pic.targets.length, 0);
});

test("filteredSpawnEnv drops unrelated secrets from the parent process", () => {
  const env = filteredSpawnEnv({
    PATH: "/usr/bin",
    HOME: "/tmp",
    AWS_SECRET_ACCESS_KEY: "nope",
    LANGFUSE_SECRET_KEY: "also-nope",
    FUSION_CONFIG: "/tmp/c",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.FUSION_CONFIG, "/tmp/c");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.LANGFUSE_SECRET_KEY, undefined);
});
