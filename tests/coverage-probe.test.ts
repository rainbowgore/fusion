import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigSchema } from "../src/config/schema.ts";
import { buildCoverage } from "../src/engine/coverage.ts";
import { hermesCaptureWired } from "../src/sources/hermes.ts";

process.env.FUSION_SKIP_DISCOVER = "1";

test("coverage is unknown when Langfuse cannot be reached, not idle", async () => {
  const cfg = ConfigSchema.parse({
    sink: "cloud",
    activeTarget: "t",
    sources: { "claude-code": true, codex: false, cursor: false, hermes: false },
    targets: [
      {
        name: "t",
        kind: "cloud",
        host: "http://127.0.0.1:1",
        publicKey: "pk-lf-x",
        secretKey: "sk-lf-y",
      },
    ],
  });
  const cov = await buildCoverage(cfg);
  assert.equal(cov.probe.ok, false);
  const cc = cov.endpoints.find((e) => e.client === "claude-code");
  assert.ok(cc);
  assert.equal(cc.status, "unknown");
  assert.match(cc.detail, /Langfuse unreachable/i);
});

test("coverage with no keys is unknown, not flowing", async () => {
  const cfg = ConfigSchema.parse({
    sink: "cloud",
    activeTarget: "t",
    sources: { "claude-code": true },
    targets: [{ name: "t", kind: "cloud", host: "https://cloud.langfuse.com" }],
  });
  const cov = await buildCoverage(cfg);
  assert.equal(cov.probe.ok, false);
  if (!cov.probe.ok) {
    assert.match(cov.probe.message, /no Langfuse found yet/i);
  }
  assert.equal(cov.langfuseOpenUrl, "");
  assert.equal(cov.endpoints.find((e) => e.client === "claude-code")?.status, "unknown");
  assert.match(cov.endpoints.find((e) => e.client === "claude-code")?.detail ?? "", /No Langfuse found yet/i);
});

test("lite coverage skips live Langfuse so the UI can paint", async () => {
  const cfg = ConfigSchema.parse({
    sink: "cloud",
    activeTarget: "t",
    sources: { "claude-code": true, codex: false, cursor: false, hermes: false },
    targets: [
      {
        name: "t",
        kind: "cloud",
        host: "http://127.0.0.1:1",
        publicKey: "pk-lf-x",
        secretKey: "sk-lf-y",
      },
    ],
  });
  const cov = await buildCoverage(cfg, { live: false });
  assert.equal(cov.probe.ok, true);
  assert.equal(cov.endpoints.find((e) => e.client === "claude-code")?.status, "configured");
  assert.equal(cov.endpoints.find((e) => e.client === "cursor")?.status, "subscription");
  assert.ok(Array.isArray(cov.discovered));
  assert.ok(cov.scan);
  assert.ok(cov.scan.docker === "up" || cov.scan.docker === "down" || cov.scan.docker === "error");
  assert.match(cov.endpoints.find((e) => e.client === "cursor")?.detail ?? "", /Does not go through Fusion/);
});

test("placeholder localhost Langfuse is not opened or probed", async () => {
  const cfg = ConfigSchema.parse({
    sink: "gateway-only",
    activeTarget: "local",
    sources: { "claude-code": true, codex: true },
    targets: [{ name: "local", kind: "local", host: "http://localhost:3005", publicKey: "", secretKey: "" }],
  });
  const cov = await buildCoverage(cfg);
  assert.equal(cov.langfuseOpenUrl, "");
  assert.equal(cov.activeHost, "");
  if (!cov.probe.ok) assert.equal(cov.probe.reason, "no-target");
  assert.doesNotMatch(JSON.stringify(cov), /3005/);
});

test("hermesCaptureWired is base_url, not a comment", () => {
  assert.equal(hermesCaptureWired("# /gw/hermes in a comment\nmodel:\n  base_url: https://api.anthropic.com\n"), false);
  assert.equal(
    hermesCaptureWired("model:\n  base_url: http://127.0.0.1:4600/k/tok/gw/hermes\n"),
    true,
  );
});
