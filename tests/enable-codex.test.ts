import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CODEX_MARKER, codexOtlpEndpoint, enableCodex } from "../src/sources/enable.ts";

test("enableCodex adopts an existing [otel] that already targets Fusion", () => {
  const dir = mkdtempSync(join(tmpdir(), "fusion-codex-"));
  const path = join(dir, "config.toml");
  process.env.FUSION_CODEX_CONFIG = path;
  writeFileSync(
    path,
    `[otel]\nenvironment = "production"\n\n[otel.exporter.otlp-http]\nendpoint = "http://localhost:4318"\nprotocol = "json"\n`,
  );
  const r = enableCodex("http://127.0.0.1:4318", false);
  assert.equal(r.ok, true);
  assert.match(r.message, /already exports OTLP/i);
  assert.equal(readFileSync(path, "utf8").includes(CODEX_MARKER), false);
  delete process.env.FUSION_CODEX_CONFIG;
});

test("enableCodex refuses a conflicting [otel] endpoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "fusion-codex-"));
  const path = join(dir, "config.toml");
  process.env.FUSION_CODEX_CONFIG = path;
  writeFileSync(
    path,
    `[otel]\n[otel.exporter.otlp-http]\nendpoint = "http://127.0.0.1:9999"\n`,
  );
  const r = enableCodex("http://127.0.0.1:4318", false);
  assert.equal(r.ok, false);
  assert.match(r.message, /9999/);
  delete process.env.FUSION_CODEX_CONFIG;
});

test("codexOtlpEndpoint reads the exporter table", () => {
  assert.equal(
    codexOtlpEndpoint(`[otel]\n[otel.exporter.otlp-http]\nendpoint = "http://127.0.0.1:4318"\n`),
    "http://127.0.0.1:4318",
  );
});
