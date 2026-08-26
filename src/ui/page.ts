import { DOCS_PAGES } from "./docs.js";
import { logoImg, providerLogoDataUris } from "./logos.js";

const GITHUB_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 98 96" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.419-3.042.334-3.042.334-3.042 4.934.326 7.523 5.052 7.523 5.052 4.367 8.496 11.404 6.052 14.235 4.607.418-3.388 1.67-6.052 3.02-7.441-10.837-1.226-22.21-5.226-22.21-23.141 0-5.052 1.84-9.227 4.788-12.48-.48-1.226-2.09-6.275.46-13.088 0 0 3.874-1.226 12.736 4.79 3.69-1.08 7.65-1.62 11.61-1.62 3.96 0 7.92.54 11.61 1.62 8.862-6.016 12.736-4.79 12.736-4.79 2.55 6.813.94 11.862.46 13.088 2.95 3.253 4.788 7.428 4.788 12.48 0 17.995-11.386 21.9-22.25 23.1 1.75 1.5 3.3 4.47 3.3 9.02 0 6.52-.08 11.77-.08 13.37 0 1.3.89 2.86 3.33 2.36 19.4-6.52 33.38-24.94 33.38-46.69C97.707 22 75.788 0 48.854 0z"/></svg>';

const DOCKER_MARK_SVG =
  '<svg class="rib-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 3.2 24 17.2" aria-hidden="true"><path fill="currentColor" d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/></svg>';

const FUSION_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="95 70 322 330" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="32" stroke-linejoin="round" stroke-linecap="round"><path d="M 256.0 82.0 L 347.3 148.3 L 312.4 255.7 L 199.6 255.7 L 164.7 148.3 Z"/><path d="M 406.7 343.0 L 303.6 388.9 L 228.1 305.0 L 284.5 207.3 L 394.9 230.8 Z"/><path d="M 105.3 343.0 L 117.1 230.8 L 227.5 207.3 L 283.9 305.0 L 208.4 388.9 Z"/></g></svg>';

function fusionHeaderMark(): string {
  return `<div class="mark" aria-label="Fusion">
<span class="letters">Fusi</span>
<button type="button" id="load-btn" class="load-btn loading" aria-label="Reload Fusion" title="Reload">${FUSION_MARK_SVG}</button>
<span class="letters">n</span>
</div>`;
}

/**
 * The Fusion governance console — board layout: health ribbon, client tiles, routing + govern.
 */
export function consoleHtml(opts?: { govern?: boolean }): string {
  const logos = providerLogoDataUris();
  const governScript = `<script>window.__FUSION_GOVERN__=${opts?.govern ? "true" : "false"}</script>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fusion</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" />
${governScript}
<style>
  @font-face {
    font-family:"SF Mono";
    src:url("/fonts/SFMono.ttf") format("truetype");
    font-weight:400;
    font-style:normal;
    font-display:block;
  }
  @font-face {
    font-family:"Latin Modern Math";
    src:url("/fonts/latinmodern-math.otf") format("opentype");
    font-weight:400;
    font-style:normal;
    font-display:block;
  }
  :root {
    --bg:#050505; --ink:#f4f4f4; --mute:#8a8a8a; --line:#222; --card:#0c0c0c; --bad:#c96a6a;
    --font:"SF Mono",ui-monospace,Menlo,Monaco,Consolas,monospace;
    --mono:"SF Mono",ui-monospace,Menlo,Monaco,Consolas,monospace;
    --warn:#c9c9c9; --ok:#4ade80;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--bg); color:var(--ink); font-family:var(--font); font-size:14px; }
  .wrap { max-width:1080px; margin:0 auto; padding:28px 28px 80px; }
  .head { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; margin-bottom:28px; }
  .head .id { min-width:0; }
  .mark { display:flex; align-items:center; gap:0.06em; color:var(--ink); font-size:56px; }
  .letters {
    font-family:"Latin Modern Math","Latin Modern Roman",serif;
    font-size:1em; line-height:1; font-weight:400; letter-spacing:0.02em;
  }
  .head-tools { display:flex; align-items:center; gap:10px; margin-top:12px; }
  #docker-chip { position:fixed; top:16px; right:18px; z-index:30; }
  #docker-chip .rib { transform:scale(0.82); transform-origin:top right; }
  a#lf-open, a#docs-link {
    color:var(--mute); text-decoration:none; font-size:11px; letter-spacing:.12em;
    font-family:var(--mono);
  }
  a#lf-open:hover, a#docs-link:hover, a#docs-link.on { color:var(--ink); }
  .head-sep { color:var(--mute); font-size:11px; font-family:var(--mono); }
  a.gh { display:inline-flex; color:var(--ink); line-height:0; }
  a.gh svg { width:16px; height:16px; display:block; }
  a.gh:hover { color:#fff; }
  body.show-docs #lf-open, body.show-docs #lf-sep { display:none !important; }
  button.load-btn { background:none; border:none; padding:0; cursor:pointer; line-height:0; flex:0 0 auto; font-size:inherit; }
  button.load-btn svg { width:0.4em; height:0.4em; display:block; }
  button.load-btn.loading svg, .boot.loading svg { animation: fuseblink .85s ease-in-out infinite; }
  @keyframes fuseblink { 0%,100% { opacity:1; } 50% { opacity:.12; } }
  @media (prefers-reduced-motion: reduce) {
    button.load-btn.loading svg, .boot.loading svg { animation:none; opacity:.55; }
    .pixload i { animation:none; opacity:.35; }
  }
  .boot { position:fixed; inset:0; background:#050505; display:flex; align-items:center; justify-content:center; z-index:40; }
  .boot svg { width:96px; height:96px; }
  .boot.done { display:none; }
  .head a { color:var(--ink); font-size:12px; }
  .instances { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin:0 0 22px; align-items:start; }
  @media (max-width:720px) { .instances { grid-template-columns:1fr; gap:28px; } }
  .inst-head { font-size:12px; color:var(--mute); margin:0 0 14px; }
  .inst-col h2 {
    font-size:10px; font-weight:400; letter-spacing:.16em; text-transform:uppercase;
    color:var(--mute); margin:0 0 12px; padding-bottom:10px; border-bottom:1px solid var(--line);
  }
  .inst-col h2 b { color:var(--ink); font-weight:400; margin-left:8px; letter-spacing:0; text-transform:none; font-size:12px; }
  .inst { background:var(--card); border:1px solid var(--line); padding:12px 14px; margin-bottom:10px; }
  .inst.plain { display:flex; align-items:center; gap:12px; }
  .inst .row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px; }
  .inst .role { font-size:13px; margin:0; }
  .inst .host { font-size:11px; color:var(--mute); margin:0 0 8px; word-break:break-all; }
  .inst.plain .host { margin:0; color:var(--ink); flex:1; min-width:0; }
  .inst .tags { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; }
  .inst .tag { font-size:10px; color:var(--mute); border:1px solid var(--line); padding:2px 6px; border-radius:4px; font-family:var(--mono); text-transform:uppercase; letter-spacing:.04em; }
  .inst .tag.ok { color:var(--ok); border-color:#1a3a26; }
  .inst .tag.bad { color:var(--bad); border-color:#4a2a2a; }
  .inst a { font-size:12px; }
  .inst .open { margin-left:auto; }
  .pixload {
    flex:0 0 14px; width:14px; height:14px;
    display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(3,1fr); gap:1px;
  }
  .pixload i { background:var(--ink); opacity:.12; animation: pixpulse .8s steps(1,end) infinite; }
  .pixload i:nth-child(1) { animation-delay:0s; }
  .pixload i:nth-child(2) { animation-delay:.1s; }
  .pixload i:nth-child(3) { animation-delay:.2s; }
  .pixload i:nth-child(4) { animation-delay:.7s; }
  .pixload i:nth-child(5) { opacity:0; animation:none; }
  .pixload i:nth-child(6) { animation-delay:.3s; }
  .pixload i:nth-child(7) { animation-delay:.6s; }
  .pixload i:nth-child(8) { animation-delay:.5s; }
  .pixload i:nth-child(9) { animation-delay:.4s; }
  @keyframes pixpulse { 0%,12% { opacity:1; } 13%,100% { opacity:.12; } }
  .gov-msg { margin:0 0 14px; font-size:13px; color:var(--mute); min-height:18px; }
  .gov-msg.ok { color:var(--ink); } .gov-msg.bad { color:var(--bad); }
  .ribbon { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:22px; }
  .rib {
    display:inline-flex; align-items:stretch; border-radius:999px; overflow:hidden;
    border:1px solid var(--line); font-size:12px;
  }
  .rib span {
    display:flex; align-items:center; gap:6px; padding:6px 10px 6px 12px;
    color:var(--mute); font-size:10px; font-family:var(--mono);
    letter-spacing:.06em; text-transform:uppercase;
  }
  .rib b {
    display:flex; align-items:center; padding:6px 12px 6px 10px;
    background:#121212; font-weight:400; color:var(--ink);
  }
  .rib.skip b { color:var(--mute); }
  .rib.bad b { color:var(--bad); }
  .rib.ok b { color:var(--ok); background:#102218; }
  .rib .rib-logo {
    width:36px; height:26px; display:block; flex:0 0 auto; color:var(--ink);
  }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:22px; }
  .tile { background:var(--card); border:1px solid var(--line); padding:16px; min-height:132px; display:flex; flex-direction:column; }
  .tile .tool-logo { width:24px; height:24px; object-fit:contain; margin-bottom:10px; }
  .tile h2 { margin:0 0 auto; font-size:16px; font-weight:560; }
  .tile .meta { color:var(--mute); font-size:12px; line-height:1.4; margin:10px 0 12px; }
  .pill { align-self:flex-start; font-family:var(--mono); font-size:10px; letter-spacing:.08em; text-transform:uppercase; border:1px solid var(--line); padding:3px 7px; color:var(--mute); cursor:default; transition:color .15s,border-color .15s,box-shadow .15s; }
  .pill.on { color:var(--ink); border-color:#555; }
  .pill.bad { color:var(--bad); border-color:#5a3030; }
  .pill:hover {
    color:#ff4dff; border-color:#ff4dff;
    box-shadow:0 0 8px #ff4dff, 0 0 20px rgba(255,77,255,.35);
  }
  .tile .btn { margin-top:10px; align-self:flex-start; }
  .desk { display:flex; flex-direction:column; gap:10px; }
  .card { background:var(--card); border:1px solid var(--line); padding:16px 18px; }
  .card h3 { margin:0 0 12px; font-size:13px; font-weight:560; color:var(--mute); }
  .acts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:0 0 20px; }
  .forms { display:grid; grid-template-columns:1fr 1fr; gap:28px; align-items:start; }
  table { width:100%; border-collapse:collapse; font-family:var(--mono); font-size:12px; }
  th,td { text-align:left; padding:8px 0; border-bottom:1px solid var(--line); }
  th { color:var(--mute); font-weight:400; }
  .gov button, button.btn {
    display:block; width:100%; text-align:left; margin:0;
    background:transparent; color:var(--ink); border:1px solid #444;
    font:inherit; font-size:13px; padding:9px 10px; cursor:pointer;
  }
  .gov button:hover, button.btn:hover { border-color:var(--ink); }
  .gov .tool-logo { width:22px; height:22px; object-fit:contain; display:inline-block; vertical-align:middle; margin-right:8px; }
  .gov input { width:100%; background:var(--bg); border:1px solid var(--line); color:var(--ink); font:inherit; font-size:13px; padding:8px 10px; margin-bottom:8px; }
  .gov input:focus { outline:none; border-color:var(--ink); }
  label.field { display:block; color:var(--mute); font-size:11px; margin:6px 0 4px; }
  .gov-title { font-size:11px; color:var(--mute); margin:0 0 8px; }
  .hint { color:var(--mute); font-size:13px; }
  a { color:var(--ink); }
  .docs-shell { display:none; margin-top:8px; }
  body.show-docs .board { display:none; }
  body.show-docs .docs-shell { display:grid; grid-template-columns:220px 1fr; gap:56px; align-items:start; }
  .docs-toc .group { margin:0 0 28px; }
  .docs-toc .group:last-child { margin-bottom:0; }
  .docs-toc .sec {
    font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--mute);
    margin:0 0 10px; padding-bottom:8px; border-bottom:1px solid var(--line); font-weight:400;
  }
  .docs-toc a {
    display:block; color:var(--mute); text-decoration:none;
    font-size:14px; line-height:1.35; padding:7px 0 7px 12px;
    border-left:1px solid var(--line);
  }
  .docs-toc a:hover { color:var(--ink); }
  .docs-toc a.now { color:var(--ink); border-left-color:var(--ink); }
  .docs-article h1 { font-size:28px; font-weight:560; letter-spacing:-.02em; margin:0 0 10px; }
  .docs-article .lead { color:var(--mute); font-size:16px; line-height:1.5; margin:0 0 22px; }
  .docs-article h3 { font-size:11px; font-weight:400; letter-spacing:.14em; text-transform:uppercase; color:var(--mute); margin:32px 0 10px; }
  .docs-article p { margin:0 0 14px; font-size:15px; line-height:1.65; color:#c8c8c8; }
  .docs-article ul { margin:0 0 16px; padding-left:18px; color:#c8c8c8; font-size:15px; line-height:1.65; }
  .docs-article code { font-family:var(--mono); font-size:12px; color:var(--ink); }
  .docs-article pre { background:var(--card); border:1px solid var(--line); padding:14px 16px; overflow:auto; margin:0 0 18px; }
  .docs-article pre code { font-size:12px; }
  .docs-article table { margin:0 0 18px; }
  .docs-pager { display:flex; justify-content:space-between; gap:16px; margin-top:36px; padding-top:16px; border-top:1px solid var(--line); }
  .docs-pager a { color:var(--mute); text-decoration:none; font-size:13px; }
  .docs-pager a:hover { color:var(--ink); }
  .docs-pager .next { margin-left:auto; text-align:right; }
  @media (max-width:800px) {
    .grid,.acts,.forms,body.show-docs .docs-shell { grid-template-columns:1fr 1fr; }
    body.show-docs .docs-shell { grid-template-columns:1fr; }
    .mark { font-size:32px; }
  }
</style>
</head>
<body>
  <div id="boot" class="boot loading" aria-live="polite" aria-busy="true">${FUSION_MARK_SVG}</div>
  <div id="docker-chip" aria-label="Docker status"></div>
  <div class="wrap">
    <div class="head">
      <div class="id">
        ${fusionHeaderMark()}
        <div class="head-tools">
          <a id="lf-open" href="#" target="_blank" rel="noreferrer" hidden aria-label="Open Langfuse">open 🪢</a>
          <span id="lf-sep" class="head-sep" hidden>|</span>
          <a href="#docs/overview" id="docs-link">docs</a>
          <span class="head-sep">|</span>
          <a class="gh" href="https://github.com/rainbowgore/fusion" target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub">${GITHUB_MARK_SVG}</a>
        </div>
      </div>
    </div>
  <div id="gov-msg" class="gov-msg"></div>
    <div class="board">
      <div id="health-chips" class="ribbon"></div>
      <div id="instances" class="instances"></div>
      <div id="endpoints" class="grid"></div>
      <div class="desk">
        <div class="card" id="routes-card" hidden>
          <h3>Linked directories</h3>
    <div id="routes"></div>
        </div>
        <div class="card gov" id="govern" hidden>
          <h3>Govern</h3>
          <div class="acts">
            <button type="button" class="act" data-act="enable-source" data-body='{"source":"claude-code"}'>${logoImg(logos["claude-code"], 22)}Enable Claude Code</button>
            <button type="button" class="act" data-act="enable-source" data-body='{"source":"codex"}'>${logoImg(logos.codex, 22)}Enable Codex</button>
            <button type="button" class="act" data-act="enable-source" data-body='{"source":"hermes"}'>${logoImg(logos.hermes, 22)}Enable Hermes</button>
            <button type="button" class="act" data-act="prices-sync" data-body="{}">Sync model prices</button>
          </div>
          <div class="forms">
      <form class="gov" data-action="target-add">
        <div class="gov-title">Add target</div>
        <label class="field">Name</label>
        <input name="name" placeholder="cloud" required />
        <label class="field">Host</label>
        <input name="host" placeholder="https://cloud.langfuse.com" required />
        <label class="field">Public key</label>
        <input name="publicKey" placeholder="pk-lf-…" required />
        <label class="field">Secret key</label>
        <input name="secretKey" placeholder="sk-lf-…" type="password" required />
              <button class="btn" type="submit">Test & add</button>
      </form>
      <form class="gov" data-action="project-link">
        <div class="gov-title">Link directory</div>
        <label class="field">Directory</label>
        <input name="dir" placeholder="/abs/path/to/dir" required />
        <label class="field">Project</label>
        <input name="project" placeholder="project name" required />
        <label class="field">Target</label>
        <input name="target" placeholder="optional" />
              <button class="btn" type="submit">Link</button>
      </form>
          </div>
      </div>
      </div>
    </div>
    <div class="docs-shell" id="docs" aria-label="Documentation">
      <aside class="docs-toc" id="docs-toc"></aside>
      <article class="docs-article" id="docs-article"></article>
    </div>
  </div>
  <script>window.__FUSION_LOGOS__=${JSON.stringify(logos)}</script>
  <script>window.__FUSION_DOCS__=${JSON.stringify(DOCS_PAGES)}</script>
  <script>${CLIENT_JS}</script>
</body>
</html>`;
}

const CLIENT_JS =
  `const DOCKER_MARK = ${JSON.stringify(DOCKER_MARK_SVG)};
` +
  String.raw`
const $ = (id) => document.getElementById(id);
let cov = null;
const esc = (s) => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function loadHealth() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("/api/health", { signal: ctrl.signal, credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP "+res.status);
    const { checks } = await res.json();
    const keep = [
      ["core-daemon", "Daemon"],
      ["gateway", "Gateway"],
      ["bridge", "Bridge"],
      ["langfuse", "Langfuse"]
    ];
    const by = Object.fromEntries(checks.map(c => [c.name, c]));
    const short = { ok:"up", fail:"down", warn:"check", skip:"off", off:"off", unknown:"—" };
    const ribWord = (name, st, c) => {
      if (name === "docker") {
        if (st === "ok") return "up";
        if (st === "warn") return "check";
        if (st === "fail") return "down";
        return "off";
      }
      if (name === "langfuse") {
        if (st === "skip") return (c && /no Langfuse target/.test(c.detail||"")) ? "none" : "set";
        if (st === "warn") return "keys";
        if (st === "unknown") return "none";
      }
      return short[st]||st;
    };
    const ribHtml = (name, label) => {
      const c = by[name];
      const st = c ? c.status : "unknown";
      const extra = st==="fail"||st==="down" ? " bad" : st==="skip"||st==="off" ? " skip" : st==="ok" ? " ok" : "";
      const left = name==="docker"
        ? DOCKER_MARK+'Docker'
        : label;
      const tip = c && c.detail ? ' title="'+esc(c.detail)+'"' : "";
      return '<div class="rib'+extra+'"'+tip+'><span>'+left+'</span><b>'+esc(ribWord(name, st, c))+'</b></div>';
    };
    $("health-chips").innerHTML = keep.map(([name, label]) => ribHtml(name, label)).join("");
    const dc = $("docker-chip");
    if (dc) dc.innerHTML = ribHtml("docker", "Docker");
  } catch (e) {
    const el = $("health-chips");
    if (el) el.innerHTML = '<div class="rib bad"><span>Health</span><b>error</b></div>';
  } finally {
    clearTimeout(t);
  }
}

function logoFor(client) {
  const embedded = (window.__FUSION_LOGOS__ || {})[client];
  if (embedded) return embedded;
  return ({ "claude-code":"/providers/claude-code.png", "codex":"/providers/codex.png", "cursor":"/providers/cursor.png", "hermes":"/providers/hermes.png" })[client] || "";
}
function pillClass(status) {
  if (status === "flowing" || status === "configured") return "pill on";
  if (status === "bypassed" || status === "down") return "pill bad";
  return "pill";
}
function toolItem(e, canGov) {
  const logo = logoFor(e.client);
  const mark = logo ? '<img class="tool-logo" src="'+esc(logo)+'" alt="" width="36" height="36">' : '';
  let action = '';
  if (canGov && e.status === "down" && ["claude-code","codex","hermes"].includes(e.client))
    action = '<button type="button" class="btn act" data-act="enable-source" data-body=\'{"source":"'+esc(e.client)+'"}\'>Enable</button>';
  return '<div class="tile">'+mark+'<h2>'+esc(e.name)+'</h2><p class="meta">'+esc(e.detail)+'</p><span class="'+pillClass(e.status)+'">'+esc(e.status)+'</span>'+action+'</div>';
}
function endpointsList(d) {
  if (!d.endpoints || !d.endpoints.length) return '<div class="hint">no clients known</div>';
  const canGov = Boolean(window.__FUSION_GOVERN__);
  return d.endpoints.map(e => toolItem(e, canGov)).join("");
}

function portLabel(host) {
  const m = String(host).match(/:(\d+)(?:[/?#]|$)/);
  return m ? m[1] : "";
}
function foundVia(source) {
  return ({ docker:"Docker", listen:"this machine", env:"env", mcp:"MCP", config:"config" })[source] || source;
}
function instanceCard(x) {
  const host = String(x.host || "");
  const via = foundVia(x.source);
  const st = x.healthy ? "up" : "down";
  const open = /^https?:\/\//.test(host) ? '<a class="open" href="'+esc(host)+'" target="_blank" rel="noreferrer" title="Open this Langfuse UI in a new tab">open UI</a>' : "";
  const tags = [
    '<span class="tag '+(x.healthy?"ok":"bad")+'">'+esc(st)+'</span>',
    '<span class="tag">'+esc(via)+'</span>',
    '<span class="tag">'+esc(x.hasKeys ? "has keys" : "needs keys")+'</span>'
  ].join("");
  return '<article class="inst"><div class="row"><p class="role">Local Langfuse</p>'+open+'</div><p class="host">'+esc(host)+'</p><div class="tags">'+tags+'</div></article>';
}
function localInstances(d) {
  const rows = (d.discovered || []).filter((x) => x.kind === "local" || x.source === "docker");
  const head = '<p class="inst-head">Langfuse instances Fusion found on this machine. Use them as the sink, or open them in the browser.</p>';
  if (!rows.length) {
    if (d.scan && d.scan.dockerDetail === "checking")
      return head+'<div class="inst plain"><span class="pixload" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="host">Scanning for local Langfuse instances...</span></div>';
    const dockerErr = d.scan && d.scan.docker === "error";
    const dockerDown = d.scan && d.scan.docker === "down";
    const msg = dockerErr
      ? (d.scan.dockerDetail || "Docker error")
      : dockerDown
      ? "Docker is off — start Docker Desktop to see a local Langfuse"
      : "No local Langfuse instance found (Docker, network listeners, env, or config)";
    const src = dockerErr ? "docker error" : dockerDown ? "docker off" : "none found";
    return head+'<div class="inst plain"><span class="host">'+esc(msg)+'</span><span class="tag">'+esc(src)+'</span></div>';
  }
  const up = rows.filter((x) => x.healthy);
  const down = rows.filter((x) => !x.healthy);
  let html = head;
  html += '<section class="inst-col"><h2>Reachable <b>'+up.length+'</b></h2>'+(up.length?up.map(instanceCard).join(""):'<p class="hint">none</p>')+'</section>';
  html += '<section class="inst-col"><h2>Not reachable <b>'+down.length+'</b></h2>'+(down.length?down.map(instanceCard).join(""):'<p class="hint">none</p>')+'</section>';
  if (d.probe && d.probe.ok === false && d.probe.message)
    html += '<div class="inst plain"><span class="host">'+esc(d.probe.message)+'</span><span class="tag">cloud</span></div>';
  return html;
}

function routesList(d) {
  if (!d.routes || !d.routes.length) return "";
  const body = d.routes.map(r =>
    '<tr><td>'+esc(r.dir)+'</td><td>'+esc(r.project)+'</td><td>'+esc(r.target||"active")+'</td></tr>').join("");
  return '<table><thead><tr><th>Directory</th><th>Project</th><th>Target</th></tr></thead><tbody>'+body+'</tbody></table>';
}

function render(d) {
  cov = d;
  const inst = $("instances");
  if (inst) inst.innerHTML = localInstances(d);
  const ep = $("endpoints");
  if (ep) ep.innerHTML = endpointsList(d);
  const rt = $("routes");
  const rtCard = $("routes-card");
  if (rt && rtCard) {
    const html = routesList(d);
    rt.innerHTML = html;
    rtCard.hidden = !html;
  }
  const lf = $("lf-open");
  const lfSep = $("lf-sep");
  if (!lf) return;
    const open = d.langfuseOpenUrl;
  if (open && /^https?:\/\//.test(open)) {
    lf.hidden = false;
    lf.href = open;
    lf.textContent = "open 🪢";
    if (lfSep) lfSep.hidden = false;
  } else {
    lf.hidden = true;
    lf.removeAttribute("href");
    if (lfSep) lfSep.hidden = true;
  }
  wireGovern();
}

function setLoading(on) {
  const btn = $("load-btn");
  const boot = $("boot");
  if (btn) {
    btn.classList.toggle("loading", on);
    btn.setAttribute("aria-busy", on ? "true" : "false");
  }
  if (!boot) return;
  if (on && !boot.dataset.ready) {
    boot.classList.add("loading");
    boot.setAttribute("aria-busy", "true");
  }
  if (!on) {
    boot.dataset.ready = "1";
    boot.classList.remove("loading");
    boot.classList.add("done");
    boot.setAttribute("aria-busy", "false");
  }
}

async function fetchCoverage(lite) {
  const ctrl = new AbortController();
  const ms = lite ? 8000 : 30000;
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch("/api/coverage"+(lite ? "?lite=1" : ""), { signal: ctrl.signal, credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP "+res.status);
    const data = await res.json();
    render(data);
  } catch (e) {
    if (cov) return;
    const el = $("endpoints");
    if (!el) return;
    const aborted = e && (e.name === "AbortError" || /aborted/i.test(String(e.message||e)));
    el.innerHTML = aborted
      ? '<div class="hint">Still checking Langfuse…</div>'
      : '<div class="hint">Could not load tool status: '+(e && e.message ? e.message : e)+'</div>';
  } finally {
    clearTimeout(t);
  }
}

async function load() {
  setLoading(true);
  const boot = $("boot");
  const first = Boolean(boot && !boot.dataset.ready);
  loadHealth();
  try {
    if (first) {
      const started = Date.now();
      await Promise.race([
        fetchCoverage(true),
        new Promise((r) => setTimeout(r, 900)),
      ]);
      const wait = Math.max(0, 700 - (Date.now() - started));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      setLoading(false);
      fetchCoverage(false);
    } else {
      await fetchCoverage(false);
    }
  } finally {
    setLoading(false);
  }
}

async function post(action, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
  const res = await fetch("/control/"+action, { method:"POST",
      credentials: "same-origin",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(body), signal: ctrl.signal });
  let data = {};
    try { data = await res.json(); } catch (err) { data = { error: String(err) }; }
  if (!res.ok) {
    const msg = data.message || data.error || ("HTTP "+res.status);
    return { ok: false, message: msg };
  }
  return data;
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}
function govMsg(t, ok) { const el=$("gov-msg"); if (!el) return; el.hidden=false; el.textContent=t; el.className="gov-msg "+(ok?"ok":"bad"); }
function wireGovern() {
  const sec = $("govern");
  if (!sec) return;
  if (!window.__FUSION_GOVERN__) { sec.hidden = true; return; }
  sec.hidden = false;
  if (sec.dataset.wired) return; sec.dataset.wired = "1";
  document.querySelectorAll("form.gov").forEach(form => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      for (const k of Object.keys(body)) if (body[k]==="") delete body[k];
      govMsg("working…", true);
      try { const r = await post(form.dataset.action, body); govMsg(r.message||(r.ok?"done":"failed"), Boolean(r.ok)); if (r.ok){ form.reset(); load(); } }
      catch(err){ govMsg("error: "+err.message, false); }
    });
  });
}
document.addEventListener("click", async (e) => {
  const el = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
  const act = el && el.closest ? el.closest(".act") : null; if (!act) return;
  e.preventDefault();
  if (!window.__FUSION_GOVERN__) { govMsg("Reload this page from the Fusion UI.", false); return; }
  govMsg("working…", true);
  try {
    const r = await post(act.getAttribute("data-act"), JSON.parse(act.getAttribute("data-body")||"{}"));
    govMsg(r.message||(r.ok?"done":"failed"), Boolean(r.ok));
    if (r.ok) load();
  } catch(err){ govMsg("error: "+err.message, false); }
});
const loadBtn = $("load-btn");
if (loadBtn) loadBtn.addEventListener("click", () => load());

const DOCS = window.__FUSION_DOCS__ || [];
function docsById(id) { return DOCS.find(p => p.id === id) || DOCS[0]; }
function parseHash() {
  const raw = (location.hash || "").replace(/^#/, "");
  if (raw === "docs" || raw.startsWith("docs/"))
    return { view: "docs", docId: raw.split("/")[1] || DOCS[0]?.id || "overview" };
  return { view: "board" };
}
function renderDocsToc(active) {
  const toc = $("docs-toc");
  if (!toc) return;
  const groups = [];
  for (const p of DOCS) {
    if (!groups.length || groups[groups.length-1].section !== p.section)
      groups.push({ section: p.section, pages: [] });
    groups[groups.length-1].pages.push(p);
  }
  toc.innerHTML = groups.map(g =>
    '<div class="group"><div class="sec">'+esc(g.section)+'</div>'
    + g.pages.map(p => '<a href="#docs/'+esc(p.id)+'" class="'+(p.id===active?"now":"")+'">'+esc(p.title)+'</a>').join("")
    + '</div>'
  ).join("");
}
function renderDocsPage(id) {
  const page = docsById(id);
  const art = $("docs-article");
  if (!art || !page) return;
  const i = DOCS.findIndex(p => p.id === page.id);
  const prev = i > 0 ? DOCS[i-1] : null;
  const next = i < DOCS.length-1 ? DOCS[i+1] : null;
  const pager = '<div class="docs-pager">'
    +(prev ? '<a href="#docs/'+esc(prev.id)+'">← '+esc(prev.title)+'</a>' : '<span></span>')
    +(next ? '<a class="next" href="#docs/'+esc(next.id)+'">'+esc(next.title)+' →</a>' : '')
    +'</div>';
  art.innerHTML = '<h1>'+esc(page.title)+'</h1><p class="lead">'+esc(page.lead)+'</p>'+page.html+pager;
  renderDocsToc(page.id);
}
function applyView() {
  const { view, docId } = parseHash();
  const docsOn = view === "docs";
  document.body.classList.toggle("show-docs", docsOn);
  const link = $("docs-link");
  if (link) {
    link.textContent = docsOn ? "console" : "docs";
    link.setAttribute("href", docsOn ? "#" : "#docs/overview");
    link.classList.toggle("on", docsOn);
  }
  if (docsOn) renderDocsPage(docId);
}
window.addEventListener("hashchange", applyView);
applyView();

load();
setInterval(() => {
  if (!cov || !cov.scan || cov.scan.docker !== "down") return;
  fetchCoverage(false);
  loadHealth();
}, 10000);
`;
