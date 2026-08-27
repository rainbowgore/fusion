import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { packagedComposeFile, writeFusionRuntimeEnv, writeStack } from "../src/langfuse/stack.ts";

test("shipped compose keeps Fusion core restarting with Docker", () => {
  const yaml = readFileSync(packagedComposeFile(), "utf8");
  assert.match(yaml, /name:\s*fusion-langfuse/);
  assert.match(yaml, /\n  fusion:\n/);
  assert.match(yaml, /restart: unless-stopped/);
  assert.match(yaml, /dist\/core\/run-daemon\.js/);
});

test("writeFusionRuntimeEnv is personal; writeStack keeps secrets on second call", () => {
  const root = mkdtempSync(join(tmpdir(), "fusion-stack-"));
  process.env.FUSION_STACK_DIR = join(root, "langfuse");
  process.env.FUSION_DATA_DIR = join(root, "data");
  process.env.FUSION_CONFIG = join(root, "cfg", "config.toml");
  mkdirSync(join(root, "cfg"), { recursive: true });
  writeFileSync(process.env.FUSION_CONFIG, "activeTarget = \"local\"\n");

  const first = writeStack(3000);
  const pk = first.publicKey;
  writeFusionRuntimeEnv({
    version: 1,
    activeTarget: "local",
    targets: [],
    sources: { "claude-code": false, codex: false, cursor: false, hermes: false },
    ports: { ui: 3006, bridge: 4318, langfuseWeb: 3000, daemon: 4599, gateway: 4600 },
    links: [],
    endpoints: [],
    sink: "docker-local",
  });
  const second = writeStack(3999);
  assert.equal(second.publicKey, pk);
  const meta = JSON.parse(readFileSync(join(root, "langfuse", "fusion-stack.json"), "utf8")) as Record<string, unknown>;
  assert.equal(meta.publicKey, undefined);
  assert.equal(meta.secretKey, undefined);
  const env = readFileSync(join(root, "langfuse", ".env"), "utf8");
  assert.match(env, /FUSION_DAEMON_PORT=4599/);
  assert.match(env, /FUSION_PACKAGE_ROOT=/);
  const yaml = readFileSync(join(root, "langfuse", "docker-compose.yml"), "utf8");
  assert.match(yaml, /\n  fusion:\n/);
});
