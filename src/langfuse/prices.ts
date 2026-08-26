import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Target } from "../config/schema.js";
import { LangfuseClient, type ModelDefinition } from "./client.js";

export type OpenRouterPrice = { inputPrice: number; outputPrice: number };

/** Fetch current USD-per-token prices from OpenRouter. No API key required. */
export async function fetchOpenRouterPrices(timeoutMs = 8000): Promise<Map<string, OpenRouterPrice>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter returned HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{
        id?: string;
        pricing?: { prompt?: string | number; completion?: string | number };
      }>;
    };
    const out = new Map<string, OpenRouterPrice>();
    for (const m of body.data ?? []) {
      if (!m.id || !m.pricing) continue;
      const input = parsePrice(m.pricing.prompt);
      const output = parsePrice(m.pricing.completion);
      if (input == null || output == null) continue;
      out.set(m.id, { inputPrice: input, outputPrice: output });
    }
    return out;
  } finally {
    clearTimeout(t);
  }
}

function parsePrice(v: string | number | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Overlay live prices onto the bundled catalog. Live prices that cannot be fetched fall back to bundled values. */
export function applyLivePrices(defs: ModelDefinition[], live: Map<string, OpenRouterPrice>): {
  defs: ModelDefinition[];
  updated: number;
  missing: number;
} {
  let updated = 0, missing = 0;
  const applied = defs.map((def) => {
    if (!def.sourceId) { missing++; return def; }
    const p = live.get(def.sourceId);
    if (!p) { missing++; return def; }
    if (!Number.isFinite(p.inputPrice) || p.inputPrice < 0 || !Number.isFinite(p.outputPrice) || p.outputPrice < 0) {
      missing++;
      return def;
    }
    updated++;
    return { ...def, inputPrice: p.inputPrice, outputPrice: p.outputPrice };
  });
  return { defs: applied, updated, missing };
}

/** Strip Fusion-internal fields before sending to Langfuse. */
export function toLangfuseModel(def: ModelDefinition): ModelDefinition {
  const { sourceId: _sourceId, ...rest } = def;
  return rest;
}

/** Registers Fusion's model-price set on a target, idempotently. Shared by CLI + Govern API. */
export async function syncPrices(target: Target, file?: string): Promise<{ ok: boolean; created: number; skipped: number; failed: number; message: string }> {
  const client = new LangfuseClient(target);
  const v = await client.validate();
  if (!v.ok) return { ok: false, created: 0, skipped: 0, failed: 0, message: `Cannot reach target: ${v.message}` };

  let live: Map<string, OpenRouterPrice> | null = null;
  let liveError = "";
  try {
    live = await fetchOpenRouterPrices();
  } catch (e) {
    liveError = e instanceof Error ? e.message : String(e);
  }
  const bundled = loadPriceDefs(file);
  const { defs, updated, missing } = live ? applyLivePrices(bundled, live) : { defs: bundled, updated: 0, missing: 0 };

  const existing = new Set<string>();
  try {
    let page = 1;
    for (;;) {
      const res = await client.listModels(page, 100);
      for (const m of res.data) existing.add(m.modelName);
      if (page >= res.meta.totalPages) break;
      page++;
    }
  } catch {
    /* attempt all creates if listing fails */
  }

  let created = 0, skipped = 0, failed = 0;
  for (const def of defs) {
    if (existing.has(def.modelName)) { skipped++; continue; }
    const r = await client.createModel(toLangfuseModel(def));
    if (r.ok) created++;
    else failed++;
  }
  const base = `Prices synced: ${created} created, ${skipped} present, ${failed} failed.`;
  if (live) {
    return { ok: failed === 0, created, skipped, failed, message: `${base} ${updated} updated from OpenRouter, ${missing} using bundled fallback.` };
  }
  return { ok: failed === 0, created, skipped, failed, message: `${base} Live prices unavailable (${liveError}); used bundled values.` };
}

export function loadPriceDefs(file?: string): ModelDefinition[] {
  const path = file ?? bundledPricesPath();
  const raw = JSON.parse(readFileSync(path, "utf8")) as { models: ModelDefinition[] };
  if (!Array.isArray(raw.models)) throw new Error(`${path}: expected a "models" array`);
  return raw.models;
}

function bundledPricesPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "assets", "model-prices.json");
}
