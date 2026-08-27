import assert from "node:assert/strict";
import { test } from "node:test";
import { providerLogoDataUris } from "../src/ui/logos.ts";
import { consoleHtml } from "../src/ui/page.ts";

test("embedded logos cover every Fusion client", () => {
  const logos = providerLogoDataUris();
  for (const id of ["claude-code", "codex", "cursor", "hermes"]) {
    assert.match(logos[id] ?? "", /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  }
  const html = consoleHtml();
  assert.match(html, /class="tool-logo"/);
  assert.ok((html.match(/data:image\/png;base64,/g) ?? []).length >= 4);
});
