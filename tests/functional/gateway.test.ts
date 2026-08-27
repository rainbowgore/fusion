import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getOrCreateToken } from "../../src/core/auth.ts";
import { buildCoverage } from "../../src/engine/coverage.ts";
import { loadConfig, saveConfig } from "../../src/config/load.ts";
import { writeDotfile } from "../../src/routing/dotfile.ts";
import {
  createFunctionalEnv,
  recordAction,
  sleep,
  startDaemonInProcess,
  startMockUpstream,
} from "./setup.ts";

test("functional gateway: forward + project stamp + coverage flowing", async () => {
  const fx = await createFunctionalEnv();
  let core: Awaited<ReturnType<typeof startDaemonInProcess>> | undefined;
  let upstream: Awaited<ReturnType<typeof startMockUpstream>> | undefined;
  try {
    const cfg = fx.writeBaseConfig();
    upstream = await startMockUpstream();
    cfg.hermesCapture = {
      shape: "openai",
      upstream: upstream.host,
      previousProvider: "openai",
      previousBaseUrl: "https://api.openai.com",
    };
    cfg.sources.hermes = true;
    saveConfig(cfg);
    // coverage treats Hermes as bypassed unless config.yaml points at /gw/hermes
    writeFileSync(
      join(fx.hermesHome, "config.yaml"),
      [
        "model:",
        "  provider: openai",
        `  base_url: http://127.0.0.1:${cfg.ports.gateway}/k/testtoken/gw/hermes`,
        "",
      ].join("\n"),
      "utf8",
    );

    const projDir = join(fx.linkRoot, "gw-proj");
    mkdirSync(projDir, { recursive: true });
    writeDotfile(projDir, { project: "gateway-demo" });
    const next = loadConfig();
    next.links.push({ dir: projDir, project: "gateway-demo" });
    saveConfig(next);

    core = await startDaemonInProcess(loadConfig());
    const token = getOrCreateToken();

    const res = await fetch(
      `http://127.0.0.1:${core.gatewayPort}/k/${token}/gw/hermes/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fusion-project": "gateway-demo",
          "x-fusion-client": "hermes",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        }),
      },
    );
    assert.equal(res.status, 200, await res.text());
    assert.ok(upstream.hits.n > 0, "upstream should see forwarded request");
    recordAction("gateway", "forward hermes-style chat completion");

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && fx.lf.ingestCount.n === 0) await sleep(100);
    assert.ok(fx.lf.ingestCount.n > 0, "Langfuse should receive ingestion");
    assert.ok(
      fx.lf.tags.some((t) => t.includes("service:hermes")),
      `expected service:hermes tag, got ${JSON.stringify(fx.lf.tags)}`,
    );
    assert.ok(
      fx.lf.tags.some((t) => t.includes("project:gateway-demo")),
      `expected project:gateway-demo tag, got ${JSON.stringify(fx.lf.tags)}`,
    );
    recordAction("gateway", "project stamp on ingest");

    const coverage = await buildCoverage(loadConfig());
    const hermes = coverage.endpoints.find((e) => e.client === "hermes");
    assert.ok(hermes, "coverage missing hermes row");
    assert.equal(hermes.status, "flowing", hermes.detail);
    recordAction("gateway", "coverage flowing after tagged trace");

    // .fusion file exists as the directory stamp
    writeFileSync(join(projDir, "note.txt"), "ok", "utf8");
    recordAction("gateway", ".fusion directory stamp present");
  } finally {
    if (core) await core.close();
    if (upstream) await upstream.close();
    await fx.close();
  }
});
