import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveBindHost } from "../src/platform/bind.ts";
import { assertLinkableDir } from "../src/routing/containment.ts";
import { sessionCookieHeader, tokenFromCookie, tokenValid } from "../src/core/auth.ts";
import { acquirePid, clearPid, daemonRunning, writeHeartbeat } from "../src/core/state.ts";
import { enableClaudeCode } from "../src/sources/enable.ts";
import { consoleHtml } from "../src/ui/page.ts";

test("resolveBindHost refuses non-loopback without FUSION_BIND_UNSAFE", () => {
  assert.equal(resolveBindHost({}), "127.0.0.1");
  assert.equal(resolveBindHost({ FUSION_BIND: "localhost" }), "127.0.0.1");
  assert.throws(() => resolveBindHost({ FUSION_BIND: "0.0.0.0" }), /not loopback/);
  assert.equal(resolveBindHost({ FUSION_BIND: "0.0.0.0", FUSION_BIND_UNSAFE: "1" }), "0.0.0.0");
});

test("assertLinkableDir refuses root and missing paths", () => {
  assert.throws(() => assertLinkableDir("/"), /filesystem root/);
  const root = mkdtempSync(join(tmpdir(), "fusion-link-"));
  const dir = join(root, "repo");
  mkdirSync(dir);
  assert.equal(assertLinkableDir(dir), dir);
  assert.throws(() => assertLinkableDir(join(root, "nope")), /not a directory/);
  assert.throws(() => assertLinkableDir(dir, { FUSION_LINK_ROOT: join(root, "other") }), /outside FUSION_LINK_ROOT/);
  assert.equal(assertLinkableDir(dir, { FUSION_LINK_ROOT: root }), dir);
});

test("session token is not embedded in the console HTML", () => {
  const html = consoleHtml({ govern: true });
  assert.match(html, /__FUSION_GOVERN__=true/);
  assert.doesNotMatch(html, /__FUSION_TOKEN__/);
});

test("tokenValid accepts the session cookie", () => {
  const tok = "a".repeat(48);
  const req = { headers: { cookie: sessionCookieHeader(tok) } } as any;
  assert.equal(tokenFromCookie(req), tok);
  assert.equal(tokenValid(req, tok), true);
  assert.equal(tokenValid({ headers: {} } as any, tok), false);
});

test("acquirePid is exclusive while the holder is alive", () => {
  const root = mkdtempSync(join(tmpdir(), "fusion-pid-"));
  process.env.FUSION_DATA_DIR = root;
  assert.equal(acquirePid(process.pid), true);
  assert.equal(acquirePid(1), false);
  assert.equal(daemonRunning(), true);
  writeHeartbeat();
  clearPid();
  assert.equal(daemonRunning(), false);
});

test("enableClaudeCode is a no-op when the env file already matches", () => {
  const root = mkdtempSync(join(tmpdir(), "fusion-cc-"));
  process.env.FUSION_DATA_DIR = root;
  const first = enableClaudeCode("http://127.0.0.1:4318", false);
  assert.equal(first.ok, true);
  const body = readFileSync(first.file, "utf8");
  const second = enableClaudeCode("http://127.0.0.1:4318", false);
  assert.match(second.message, /already configured/);
  assert.equal(readFileSync(first.file, "utf8"), body);
  writeFileSync(first.file, "stale\n", "utf8");
  const third = enableClaudeCode("http://127.0.0.1:4318", false);
  assert.match(third.message, /Wrote /);
});
