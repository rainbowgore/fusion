import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigSchema } from "../src/config/schema.ts";
import { priceSyncCandidates } from "../src/core/govern.ts";

test("priceSyncCandidates prefers active, then extras, without dupes", () => {
  const cfg = ConfigSchema.parse({
    activeTarget: "cloud",
    targets: [
      { name: "cloud", kind: "cloud", host: "https://cloud.langfuse.com", publicKey: "pk-lf-a", secretKey: "sk-lf-a" },
      { name: "local-3005", kind: "local", host: "http://127.0.0.1:3005", publicKey: "pk-lf-b", secretKey: "sk-lf-b" },
    ],
  });
  const extras = [
    { name: "local-stack", kind: "local" as const, host: "http://127.0.0.1:3005", publicKey: "pk-lf-b", secretKey: "sk-lf-b", project: "default", managed: true },
    { name: "docker-init-1", kind: "local" as const, host: "http://127.0.0.1:3005/", publicKey: "pk-lf-docker", secretKey: "sk-lf-docker", project: "default", managed: false },
  ];
  const names = priceSyncCandidates(cfg, extras).map((t) => t.name);
  assert.deepEqual(names, ["cloud", "local-3005", "docker-init-1"]);
});

test("priceSyncCandidates skips targets without keys", () => {
  const cfg = ConfigSchema.parse({
    activeTarget: "cloud",
    targets: [{ name: "cloud", kind: "cloud", host: "https://cloud.langfuse.com" }],
  });
  assert.deepEqual(priceSyncCandidates(cfg), []);
});
