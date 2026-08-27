import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isDesktopAppInstalled,
  verifyCursorMcpSurface,
  verifyHermesMcpSurface,
} from "./desktop.ts";
import { recordAction, recordSkip } from "./report.ts";

test("functional desktop: helpers gate on installation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fusion-desktop-"));
  const cursorInstalled = isDesktopAppInstalled("Cursor");
  const hermesInstalled = isDesktopAppInstalled("Hermes");

  const cursor = await verifyCursorMcpSurface(dir);
  if (cursor.skipped) {
    assert.equal(cursorInstalled, false);
  } else {
    assert.equal(cursor.ok, true, cursor.detail);
    recordAction("desktop", "Cursor activate + screenshot");
  }

  const hermes = await verifyHermesMcpSurface(dir);
  if (hermes.skipped) {
    assert.equal(hermesInstalled, false);
  } else {
    assert.equal(hermes.ok, true, hermes.detail);
    recordAction("desktop", "Hermes activate + screenshot");
  }

  if (!cursorInstalled && !hermesInstalled) {
    recordSkip("desktop", "any desktop app", "neither Cursor nor Hermes Desktop installed");
  }
});
