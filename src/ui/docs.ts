/** In-console technical docs — how Fusion works. Rendered by the governance UI. */

export type DocsPage = {
  id: string;
  section: string;
  title: string;
  lead: string;
  html: string;
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

function p(text: string): string {
  return `<p>${esc(text)}</p>`;
}

function h3(text: string): string {
  return `<h3>${esc(text)}</h3>`;
}

function ul(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

function pre(code: string): string {
  return `<pre><code>${esc(code)}</code></pre>`;
}

function table(headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="maptbl"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

export const DOCS_PAGES: DocsPage[] = [
  {
    id: "overview",
    section: "How it works",
    title: "What Fusion is",
    lead: "A local control plane for capture and routing into Langfuse. Not a spend dashboard.",
    html: [
      p(
        "You already have Langfuse. Fusion is everything around it: one way to wire Claude Code, Codex, Cursor, and Hermes; a directory→project stamp at the source; and a single place that says whether capture is flowing, only configured, on a subscription path, or actually bypassed.",
      ),
      p(
        "Traces and cost stay in Langfuse. Coverage is a presence signal (a recent tagged trace), never token volume. Product pitch and setup live in the README — this console is for status and govern actions.",
      ),
      h3("Why Langfuse"),
      p(
        "Langfuse is self-hostable, OpenTelemetry-native, and the usual pick for LLM traces. Fusion is the unified layer so the clients you already use all land there.",
      ),
    ].join(""),
  },
  {
    id: "architecture",
    section: "How it works",
    title: "Where it runs",
    lead: "Fusion stays on this machine. It discovers Langfuse; it does not invent a local host.",
    html: [
      p(
        "Everything binds to 127.0.0.1. A non-loopback FUSION_BIND is refused unless FUSION_BIND_UNSAFE=1. Docker vs cloud vs gateway-only is chosen at fusion init.",
      ),
      p(
        "Fusion discovers Langfuse you already have: Docker, MCP config, LANGFUSE_* env, and local processes that answer Langfuse health. It does not hardcode a local Langfuse port. fusion host --local is only for a stack Fusion itself starts.",
      ),
      h3("Ports"),
      table(
        ["Port", "Role"],
        [
          ["<code>4599</code>", "Fusion UI and control API (this console)"],
          [
            "<code>4600</code>",
            "Gateway for Cursor and Hermes (your keys; Fusion forwards and logs)",
          ],
          [
            "<code>4318</code>",
            "OpenTelemetry from Claude Code and Codex, then into Langfuse",
          ],
        ],
      ),
      h3("Sinks"),
      ul([
        "<code>use-local</code> / <code>docker-local</code> — Langfuse Fusion found or a stack it starts.",
        "<code>use-cloud</code> / <code>cloud</code> — Langfuse Cloud; keys may already be in Cursor or Hermes.",
        "<code>gateway-only</code> — Node only; capture without a Langfuse instance on this machine.",
      ]),
    ].join(""),
  },
  {
    id: "clients",
    section: "How it works",
    title: "Clients and capture",
    lead: "Two paths: OTLP into the bridge, or BYOK through the gateway.",
    html: [
      table(
        ["Client", "Capture", "Wire"],
        [
          [
            "Claude Code",
            "OTLP → bridge <code>:4318</code>",
            "<code>fusion enable claude-code</code> (env file; source before launch)",
          ],
          [
            "Codex",
            "OTLP → same bridge (Codex patch on the collector)",
            "<code>fusion enable codex</code> (<code>~/.codex/config.toml</code>)",
          ],
          [
            "Cursor",
            "Gateway <code>:4600</code> (BYOK). Subscription traffic bypasses",
            "Point the client at the gateway; not <code>enable</code>",
          ],
          [
            "Hermes",
            "Gateway <code>:4600</code> (Fusion runs <code>hermes config set</code>)",
            "<code>fusion enable hermes</code>",
          ],
        ],
      ),
      p(
        "Hermes CLI and Desktop share ~/.hermes/config.yaml; restart after enable. OAuth-only (Nous/Copilot, no API key) is bypassed.",
      ),
      p(
        "Cursor subscription does not go through Fusion. Coverage says subscription, not an error. BYOK through the gateway is the only Cursor path Fusion can see.",
      ),
    ].join(""),
  },
  {
    id: "routing",
    section: "How it works",
    title: "Routing",
    lead: "Which Langfuse project a trace belongs to is stamped in the directory. Fusion does not guess it later.",
    html: [
      p(
        "A govern action writes a thin .fusion pointer in the folder and registers the same route in Fusion config. The shell hook exports the stamp so Claude Code / Codex OTLP and the gateway see project= at the source.",
      ),
      pre(
        'fusion project link . --to my-project\neval "$(fusion hook zsh)"   # once in ~/.zshrc (or bash)',
      ),
      p(
        "Work in the linked directory. Done when Langfuse shows a trace tagged service: plus project:.",
      ),
      h3("Authority"),
      ul([
        "Central config owns targets and keys.",
        "<code>.fusion</code> is the directory pointer, not a second source of truth for credentials.",
        "An empty route list means Fusion has not linked folders yet — not that Langfuse Cloud has no projects.",
      ]),
    ].join(""),
  },
  {
    id: "coverage",
    section: "How it works",
    title: "Coverage",
    lead: "Governance state, not analytics. Flowing means a recent tagged trace, not a toggle.",
    html: [
      table(
        ["Status", "Meaning"],
        [
          ["FLOWING", "A recent trace tagged for that client reached Langfuse"],
          ["CONFIGURED", "Wired, but no recent tagged trace"],
          [
            "SUBSCRIPTION",
            "Cursor’s usual path — it does not go through Fusion",
          ],
          [
            "BYPASSED",
            "Marked on, but traffic never hits Fusion (Hermes OAuth-only)",
          ],
          ["DOWN", "Not enabled / not reachable"],
          ["UNKNOWN", "Langfuse could not be queried — not “no activity”"],
        ],
      ),
      p(
        "If Langfuse is unreachable or keys are missing, status is unknown. Fusion will not pretend the pipeline is idle.",
      ),
      p(
        "fusion doctor checks the same chain as Health on this console and can write Langfuse keys. fusion status is that list without calling Langfuse.",
      ),
    ].join(""),
  },
  {
    id: "cli",
    section: "Setup",
    title: "cli",
    lead: "init, host, up, and the shell hook stay on the Fusion CLI.",
    html: [
      p(
        "Commands: init, host --local, up / down, enable / disable, project / route, connect, doctor / status, ui, config.",
      ),
      h3("1. Choose where traces land"),
      pre(
        "fusion init                     # finds existing Langfuse, then TTY / --sink use-local | use-cloud | docker-local | cloud | gateway-only",
      ),
      p(
        "Docker local also needs fusion host --local only if Fusion did not already find a running Langfuse. Cloud can use keys Fusion already found in Cursor or Hermes. Gateway-only is Node only.",
      ),
      h3("2. Start Fusion"),
      pre("fusion up"),
      h3("3. Capture"),
      pre(
        'fusion enable claude-code       # and/or: fusion enable codex | hermes\nfusion project link . --to my-project\neval "$(fusion hook zsh)"       # once in ~/.zshrc (or bash)',
      ),
    ].join(""),
  },
  {
    id: "mcp",
    section: "Setup",
    title: "mcp",
    lead: "Same govern actions from Cursor or Hermes. Keys stay in Fusion config.",
    html: [
      pre(
        "fusion connect cursor           # ~/.cursor/mcp.json\nfusion connect hermes           # ~/.hermes/config.yaml (CLI and Desktop)",
      ),
      p(
        "Restart the client, start a new session, ask Fusion (status, enable Hermes/Codex, link this repo). Tools are fusion_* / mcp_fusion_*.",
      ),
      h3("Fusion MCP vs Langfuse MCP"),
      table(
        ["", "Fusion MCP", "Langfuse MCP"],
        [
          [
            "Job",
            "Set up capture and routing on this machine",
            "Look at data already in Langfuse",
          ],
          [
            "You ask it",
            "Point this folder at project X. Turn on Codex. Is Cursor actually sending traces?",
            "What are the last traces for project X?",
          ],
          [
            "Tools",
            "fusion_* (see MCP tools)",
            "Langfuse’s own (traces, scores, prompts)",
          ],
        ],
      ),
    ].join(""),
  },
  {
    id: "console",
    section: "Setup",
    title: "Console",
    lead: "fusion ui — console board. Docs is its own page, opened from the top-right Docs link.",
    html: [
      p(
        "Open with fusion ui (starts the daemon if needed). One view at a time under the wordmark. Mutating calls are POST /control/* with a session token and same-origin check.",
      ),
      h3("What the console shows and does"),
      ul([
        "<strong>Pipeline health</strong> — daemon, gateway, bridge, Docker, Langfuse reachability, plus local Langfuse instances Fusion finds.",
        "<strong>What's connected</strong> — each client as FLOWING / CONFIGURED / SUBSCRIPTION / BYPASSED / DOWN.",
        "<strong>Routing map</strong> — directory → project → target.",
        "<strong>Open Langfuse</strong> — traces, metrics, and cost live there; Fusion only deep-links.",
        "<strong>Add a Langfuse target</strong> — test keys, then save.",
        "<strong>Link a directory to a project</strong> — so traces are tagged at the source.",
        "<strong>Enable Claude Code, Codex, or Hermes capture</strong> — writes the client config Fusion needs.",
        "<strong>Sync model prices</strong> — fetches current prices from OpenRouter, then registers them on the active Langfuse so it can compute cost. Falls back to bundled values if the network is unavailable.",
      ]),
      p("init, host, up, and the shell hook stay on the CLI."),
    ].join(""),
  },
  {
    id: "mcp-tools",
    section: "Reference",
    title: "Tools",
    lead: "Every tool reuses the same core functions as the CLI and /control, so the surfaces cannot diverge.",
    html: [
      table(
        ["Tool", "Function"],
        [
          [
            "<code>fusion_status</code>",
            "Health of daemon, gateway, bridge, targets",
          ],
          [
            "<code>fusion_coverage</code>",
            "FLOWING / CONFIGURED / SUBSCRIPTION / BYPASSED / DOWN + routes",
          ],
          [
            "<code>fusion_targets_list</code>",
            "Configured Langfuse targets, which is active",
          ],
          ["<code>fusion_routes_list</code>", "Directory → project links"],
          ["<code>fusion_target_test</code>", "Live ping to a target"],
          ["<code>fusion_project_link</code>", "Bind a directory to a project"],
          [
            "<code>fusion_target_add</code>",
            "Add a Langfuse target (keys validated)",
          ],
          ["<code>fusion_target_set_keys</code>", "Replace keys on a target"],
          ["<code>fusion_set_active</code>", "Switch active target"],
          [
            "<code>fusion_enable_source</code>",
            "Wire Claude Code, Codex, or Hermes",
          ],
          [
            "<code>fusion_prices_sync</code>",
            "Register model prices on the active Langfuse",
          ],
        ],
      ),
    ].join(""),
  },
  {
    id: "surfaces",
    section: "Reference",
    title: "Surfaces",
    lead: "Same govern actions. Different doors. A few operations never leave the CLI.",
    html: [
      table(
        ["Action", "CLI", "MCP", "UI"],
        [
          ["init / host / up / hook", "Yes", "No", "No"],
          ["enable source", "Yes", "Yes", "Yes"],
          ["link directory", "Yes", "Yes", "Yes"],
          ["add / test target", "Yes", "Yes", "Yes"],
          ["coverage / status", "Yes", "Yes", "Yes"],
          ["sync prices", "Yes", "Yes", "Yes"],
          ["connect Cursor / Hermes", "Yes", "—", "No"],
        ],
      ),
      p(
        "Ask the agent the same things you would type on the Fusion CLI. Langfuse keys stay in Fusion config.",
      ),
    ].join(""),
  },
];

export function docsPageIds(): string[] {
  return DOCS_PAGES.map((p) => p.id);
}
