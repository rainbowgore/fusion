import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../src/config/load.ts";
import {
  callControl,
  createFunctionalEnv,
  recordAction,
  startDaemonInProcess,
  waitForUrl,
} from "./setup.ts";

test("functional UI control: health/coverage + mutating endpoints", async () => {
  const fx = await createFunctionalEnv();
  let core: Awaited<ReturnType<typeof startDaemonInProcess>> | undefined;
  try {
    const cfg = fx.writeBaseConfig();
    core = await startDaemonInProcess(cfg);
    const base = `http://127.0.0.1:${core.daemonPort}`;

    await waitForUrl(`${base}/health`);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthJson = (await health.json()) as { checks?: unknown[] };
    assert.ok(Array.isArray(healthJson.checks));
    recordAction("ui", "GET /api/health");

    const coverage = await fetch(`${base}/api/coverage?lite=1`);
    assert.equal(coverage.status, 200);
    recordAction("ui", "GET /api/coverage");

    const openHealth = await fetch(`${base}/health`);
    assert.equal(openHealth.status, 200);
    recordAction("ui", "GET /health");

    const add = await callControl(core.daemonPort, core.token, "target-add", {
      name: "ui-extra",
      host: fx.lf.host,
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      kind: "cloud",
      use: false,
    });
    assert.equal(add.status, 200);
    assert.equal(add.json.ok, true);
    recordAction("ui", "POST /control/target-add");

    const proj = join(fx.linkRoot, "ui-link");
    mkdirSync(proj, { recursive: true });
    const link = await callControl(core.daemonPort, core.token, "project-link", {
      dir: proj,
      project: "ui-proj",
    });
    assert.equal(link.status, 200);
    assert.equal(link.json.ok, true);
    recordAction("ui", "POST /control/project-link");

    for (const source of ["claude-code", "codex"] as const) {
      const en = await callControl(core.daemonPort, core.token, "enable-source", { source });
      assert.equal(en.status, 200);
      assert.equal(en.json.ok, true, String(en.json.message));
      recordAction("ui", `POST /control/enable-source ${source}`);
    }

    // hermes may fail without real hermes CLI — still exercise the endpoint
    const hermes = await callControl(core.daemonPort, core.token, "enable-source", { source: "hermes" });
    assert.equal(hermes.status, 200);
    recordAction("ui", "POST /control/enable-source hermes");

    const prices = await callControl(core.daemonPort, core.token, "prices-sync", {});
    assert.equal(prices.status, 200);
    assert.equal(prices.json.ok, true, String(prices.json.message));
    recordAction("ui", "POST /control/prices-sync");

    const after = loadConfig();
    assert.ok(after.targets.some((t) => t.name === "ui-extra"));
    assert.ok(after.links.some((l) => l.project === "ui-proj"));
  } finally {
    if (core) await core.close();
    await fx.close();
  }
});

test("functional UI control: mutating endpoints reject bad auth / cross-origin", async () => {
  const fx = await createFunctionalEnv();
  let core: Awaited<ReturnType<typeof startDaemonInProcess>> | undefined;
  try {
    const cfg = fx.writeBaseConfig();
    core = await startDaemonInProcess(cfg);

    const noToken = await callControl(core.daemonPort, core.token, "target-add", {
      name: "x",
      host: fx.lf.host,
      publicKey: "pk",
      secretKey: "sk",
    }, { tokenHeader: null });
    assert.equal(noToken.status, 401);
    recordAction("ui", "reject missing token");

    const badToken = await callControl(core.daemonPort, core.token, "target-add", {
      name: "x",
      host: fx.lf.host,
      publicKey: "pk",
      secretKey: "sk",
    }, { tokenHeader: "deadbeef" });
    assert.equal(badToken.status, 401);
    recordAction("ui", "reject bad token");

    const cross = await callControl(
      core.daemonPort,
      core.token,
      "prices-sync",
      {},
      { origin: "https://evil.example" },
    );
    assert.equal(cross.status, 403);
    recordAction("ui", "reject cross-origin");
  } finally {
    if (core) await core.close();
    await fx.close();
  }
});
