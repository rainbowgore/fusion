import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLivePrices, toLangfuseModel } from "../src/langfuse/prices.ts";
import type { ModelDefinition } from "../src/langfuse/client.ts";

test("applyLivePrices updates matched models and keeps unmatched", () => {
  const defs: ModelDefinition[] = [
    { modelName: "gpt-4o", matchPattern: "(?i)^gpt-4o", sourceId: "openai/gpt-4o", unit: "TOKENS", inputPrice: 1, outputPrice: 2 },
    { modelName: "unknown", matchPattern: "(?i)unknown", sourceId: "vendor/unknown", unit: "TOKENS", inputPrice: 3, outputPrice: 4 },
  ];
  const live = new Map([["openai/gpt-4o", { inputPrice: 0.0000025, outputPrice: 0.00001 }]]);
  const { defs: applied, updated, missing } = applyLivePrices(defs, live);
  assert.equal(updated, 1);
  assert.equal(missing, 1);
  assert.equal(applied[0].inputPrice, 0.0000025);
  assert.equal(applied[0].outputPrice, 0.00001);
  assert.equal(applied[1].inputPrice, 3);
});

test("toLangfuseModel strips sourceId", () => {
  const def: ModelDefinition = { modelName: "gpt-4o", matchPattern: "x", sourceId: "openai/gpt-4o", unit: "TOKENS", inputPrice: 1, outputPrice: 2 };
  const stripped = toLangfuseModel(def);
  assert.equal(stripped.sourceId, undefined);
  assert.equal(stripped.modelName, "gpt-4o");
  assert.equal(stripped.inputPrice, 1);
});

test("applyLivePrices ignores invalid or negative prices", () => {
  const defs: ModelDefinition[] = [
    { modelName: "a", matchPattern: "x", sourceId: "s1", unit: "TOKENS", inputPrice: 1, outputPrice: 2 },
  ];
  const live = new Map([["s1", { inputPrice: -1, outputPrice: 0.1 }]]);
  const { defs: applied, updated, missing } = applyLivePrices(defs, live);
  assert.equal(updated, 0);
  assert.equal(missing, 1);
  assert.equal(applied[0].inputPrice, 1);
});
