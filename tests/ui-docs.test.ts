import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCS_PAGES, docsPageIds } from "../src/ui/docs.ts";
import { consoleHtml } from "../src/ui/page.ts";

test("docs pages are grouped like a technical manual", () => {
  assert.deepEqual(docsPageIds(), [
    "overview",
    "architecture",
    "clients",
    "routing",
    "coverage",
    "cli",
    "mcp",
    "console",
    "mcp-tools",
    "surfaces",
  ]);
  const sections = [...new Set(DOCS_PAGES.map((p) => p.section))];
  assert.deepEqual(sections, ["How it works", "Setup", "Reference"]);
  for (const page of DOCS_PAGES) {
    assert.ok(page.title.trim());
    assert.ok(page.lead.trim());
    assert.ok(page.html.includes("<p>") || page.html.includes("<table"));
  }
});

test("console mark matches the Fusion header crop", () => {
  const html = consoleHtml();
  assert.match(html, /viewBox="95 70 322 330"/);
  assert.doesNotMatch(html, /viewBox="0 0 512 512"/);
  assert.match(html, /@font-face/);
  assert.match(html, /\/fonts\/SFMono\.ttf/);
  assert.match(html, /class="letters">Fusi</);
  assert.match(html, /class="letters">n</);
});

test("console HTML is the board layout with docs and logos", () => {
  const html = consoleHtml();
  assert.match(html, /class="board"/);
  assert.match(html, /class="desk"/);
  assert.match(html, /class="forms"/);
  assert.match(html, /id="instances"/);
  assert.match(html, /function foundVia/);
  assert.match(html, /local Langfuse/);
  assert.match(html, /pixload/);
  assert.match(html, /class="ribbon"/);
  assert.match(html, /\.rib \.rib-logo/);
  assert.match(html, /class=\\"rib-logo\\"/);
  assert.match(html, /class="grid"/);
  assert.match(html, /__FUSION_LOGOS__/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /rel="icon" href="\/favicon\.svg"/);
  assert.match(html, /href="#docs\/overview"/);
  assert.match(html, />docs</);
  assert.match(html, /open 🪢/);
  assert.match(html, /id="lf-sep"/);
  assert.match(html, /class="head-sep"/);
  assert.match(html, /class="gh"/);
  assert.match(html, /github.com\/rainbowgore\/fusion/);
  assert.match(html, /id="docs"/);
  assert.match(html, /__FUSION_DOCS__/);
  for (const id of docsPageIds()) {
    assert.match(html, new RegExp(`"id":"${id}"`));
  }
  assert.match(html, /fusion_status/);
  assert.match(html, /4599/);
  assert.match(html, /4600/);
  assert.match(html, /4318/);
});
