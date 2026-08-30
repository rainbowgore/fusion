import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInitSink, parseInitAction, initMenuActions } from "../src/commands/init.ts";
import { preferExistingLocalActive, rememberDiscovered } from "../src/langfuse/discover.ts";
import { ConfigSchema } from "../src/config/schema.ts";

test("fusion init sink parser: named flags", () => {
  assert.equal(parseInitSink("docker-local"), "docker-local");
  assert.equal(parseInitSink("1"), "docker-local");
  assert.equal(parseInitSink("2"), "cloud");
  assert.equal(parseInitSink("cloud"), "cloud");
  assert.equal(parseInitSink("3"), "gateway-only");
  assert.equal(parseInitSink("gateway-only"), "gateway-only");
  assert.equal(parseInitSink("nope"), null);
});

test("init menu puts existing local first", () => {
  const found = [
    {
      host: "http://127.0.0.1:4012",
      kind: "local" as const,
      source: "docker" as const,
      healthy: true,
      hasKeys: false,
      projects: [],
      publicKey: "",
      secretKey: "",
    },
  ];
  assert.equal(initMenuActions(found)[0], "use-local");
  assert.equal(parseInitAction("1", found), "use-local");
  assert.equal(parseInitAction("use-local", found), "use-local");
});

test("preferExistingLocalActive wins over cloud", () => {
  const cfg = ConfigSchema.parse({
    activeTarget: "cloud",
    targets: [
      { name: "cloud", kind: "cloud", host: "https://cloud.langfuse.com", publicKey: "pk-lf-a", secretKey: "sk-lf-b" },
      { name: "local-4012", kind: "local", host: "http://127.0.0.1:4012", publicKey: "pk-lf-c", secretKey: "sk-lf-d" },
    ],
  });
  assert.equal(preferExistingLocalActive(cfg), true);
  assert.equal(cfg.activeTarget, "local-4012");
});

test("rememberDiscovered stores a healthy local host even without keys", () => {
  const cfg = ConfigSchema.parse({ activeTarget: "", targets: [] });
  rememberDiscovered(cfg, [
    {
      host: "http://127.0.0.1:4012",
      kind: "local",
      source: "listen",
      healthy: true,
      hasKeys: false,
      projects: [],
      publicKey: "",
      secretKey: "",
    },
  ]);
  assert.equal(cfg.targets[0]?.host, "http://127.0.0.1:4012");
  assert.equal(cfg.activeTarget, cfg.targets[0]?.name);
});
