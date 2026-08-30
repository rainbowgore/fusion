import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { findFreePort } from "../../src/platform/net.ts";
import { applyLivePrices, fetchOpenRouterPrices, syncPrices, toLangfuseModel } from "../../src/langfuse/prices.ts";
import type { ModelDefinition } from "../../src/langfuse/client.ts";
import { loadConfig } from "../../src/config/load.ts";
import {
  createFunctionalEnv,
  recordAction,
  recordSkip,
  runCli,
  sleep,
  startDaemonInProcess,
} from "./setup.ts";
import { emitCoverageReport } from "./report.ts";

test("functional prices: sync overlays live or falls back", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const target = loadConfig().targets[0];
    const r = await syncPrices(target);
    assert.equal(r.ok, true, r.message);
    assert.ok(fx.lf.models.length > 0 || r.created + r.skipped > 0, r.message);
    recordAction("prices", "syncPrices against mock Langfuse");

    // CLI path
    const cli = await runCli(["prices", "sync"], fx.env, 90_000);
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    recordAction("prices", "CLI prices sync");
  } finally {
    await fx.close();
  }
});

test("functional prices: applyLivePrices + toLangfuseModel", () => {
  const defs: ModelDefinition[] = [
    {
      modelName: "claude-sonnet-4",
      matchPattern: "claude-sonnet-4",
      unit: "TOKENS",
      inputPrice: 0.000003,
      outputPrice: 0.000015,
      sourceId: "anthropic/claude-sonnet-4",
    },
  ];
  const live = new Map([["anthropic/claude-sonnet-4", { inputPrice: 0.000004, outputPrice: 0.00002 }]]);
  const applied = applyLivePrices(defs, live);
  assert.equal(applied.updated, 1);
  assert.equal(applied.defs[0].inputPrice, 0.000004);
  const stripped = toLangfuseModel(applied.defs[0]);
  assert.equal("sourceId" in stripped, false);
  recordAction("prices", "applyLivePrices + toLangfuseModel");
});

test("functional prices: mock OpenRouter when network unavailable", async () => {
  const port = await findFreePort(19191);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          {
            id: "anthropic/claude-sonnet-4",
            pricing: { prompt: "0.000003", completion: "0.000015" },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const prevFetch = globalThis.fetch;
  try {
    // Force a deterministic path: stub fetch for OpenRouter only
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("openrouter.ai")) {
        return prevFetch(`http://127.0.0.1:${port}/api/v1/models`, init);
      }
      return prevFetch(input, init);
    }) as typeof fetch;

    const live = await fetchOpenRouterPrices();
    assert.ok(live.size >= 1);
    recordAction("prices", "fetchOpenRouterPrices via mock");
  } catch (err) {
    recordSkip("prices", "fetchOpenRouterPrices", (err as Error).message);
    throw err;
  } finally {
    globalThis.fetch = prevFetch;
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("functional prices: daemon background re-sync smoke", async () => {
  const fx = await createFunctionalEnv();
  let core: Awaited<ReturnType<typeof startDaemonInProcess>> | undefined;
  try {
    const cfg = fx.writeBaseConfig();
    const before = fx.lf.models.length;
    core = await startDaemonInProcess(cfg);
    // Daemon schedules first price sync ~5s after start
    await sleep(6500);
    const after = fx.lf.models.length;
    assert.ok(after >= before, "background sync should register models or leave catalog intact");
    recordAction("prices", "daemon background price sync (~5s)");
  } finally {
    if (core) await core.close();
    await fx.close();
  }
});

test("functional report: final coverage matrix", () => {
  emitCoverageReport();
});
