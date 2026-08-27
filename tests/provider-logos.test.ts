import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "assets", "providers");

test("known tool logos ship in assets/providers", () => {
  for (const name of ["claude-code.png", "cursor.png", "hermes.png", "codex.png", "docker.png"]) {
    assert.equal(existsSync(join(dir, name)), true, name);
  }
});
