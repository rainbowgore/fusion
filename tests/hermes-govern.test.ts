import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { disableHermes, enableHermes, mapHermesProvider, type HermesRunner } from "../src/sources/hermes.ts";

test("mapHermesProvider: anthropic uses anthropic shape", () => {
  const m = mapHermesProvider("anthropic", "https://api.anthropic.com");
  assert.equal(m.ok, true);
  if (m.ok) {
    assert.equal(m.shape, "anthropic");
    assert.equal(m.upstream, "https://api.anthropic.com");
  }
});

test("mapHermesProvider: oauth is refused", () => {
  const m = mapHermesProvider("nous", "");
  assert.equal(m.ok, false);
});

test("enableHermes sets model.base_url via hermes CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "fusion-hermes-"));
  const cfg = join(dir, "config.yaml");
  writeFileSync(cfg, "model:\n  provider: anthropic\n  base_url: https://api.anthropic.com\n");
  process.env.FUSION_HERMES_CONFIG = cfg;

  const calls: string[][] = [];
  const run: HermesRunner = (args) => {
    calls.push(args);
    if (args[0] === "config" && args[1] === "path") return { status: 0, stdout: cfg, stderr: "" };
    if (args.join(" ") === "config get model.provider") return { status: 0, stdout: "anthropic\n", stderr: "" };
    if (args.join(" ") === "config get model.base_url") return { status: 0, stdout: "https://api.anthropic.com\n", stderr: "" };
    if (args[0] === "config" && args[1] === "set") return { status: 0, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "unexpected " + args.join(" ") };
  };

  const r = enableHermes(4600, "tok", run);
  assert.equal(r.ok, true);
  assert.ok(r.capture);
  assert.equal(r.capture?.shape, "anthropic");
  const set = calls.find((a) => a[1] === "set");
  assert.ok(set);
  assert.equal(set?.[2], "model.base_url");
  assert.match(set?.[3] ?? "", /\/k\/tok\/gw\/hermes(\/anthropic)?$/);
});

test("disableHermes restores previous base_url", () => {
  const calls: string[][] = [];
  const run: HermesRunner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = disableHermes(
    { shape: "anthropic", upstream: "https://api.anthropic.com", previousProvider: "anthropic", previousBaseUrl: "https://api.anthropic.com" },
    run,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0], ["config", "set", "model.base_url", "https://api.anthropic.com"]);
});
