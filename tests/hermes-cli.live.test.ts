import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { disableHermes, enableHermes, hermesCaptureWired } from "../src/sources/hermes.ts";

function hermesOnPath(): boolean {
  const r = spawnSync("hermes", ["config", "-h"], { encoding: "utf8", timeout: 15_000 });
  return r.status === 0 || (r.stdout + r.stderr).includes("config");
}

test("live hermes CLI: enable then disable in isolated HERMES_HOME", async (t) => {
  if (!hermesOnPath()) {
    t.skip("hermes CLI not on PATH");
    return;
  }

  const home = mkdtempSync(join(tmpdir(), "fusion-hermes-live-"));
  const data = mkdtempSync(join(tmpdir(), "fusion-data-"));
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.yaml"),
    "model:\n  provider: anthropic\n  base_url: https://api.anthropic.com\n",
  );

  process.env.HERMES_HOME = home;
  process.env.FUSION_HERMES_CONFIG = join(home, "config.yaml");
  process.env.FUSION_DATA_DIR = data;

  const en = enableHermes(4600, "livetok");
  assert.equal(en.ok, true, en.message);
  assert.equal(en.capture?.shape, "anthropic");
  assert.equal(en.capture?.upstream, "https://api.anthropic.com");
  assert.match(readFileSync(join(home, "config.yaml"), "utf8"), /\/gw\/hermes/);
  assert.equal(hermesCaptureWired(), true);

  const dis = disableHermes(en.capture);
  assert.equal(dis.ok, true, dis.message);
  assert.match(readFileSync(join(home, "config.yaml"), "utf8"), /api\.anthropic\.com/);
  assert.equal(hermesCaptureWired(), false);
});
