/**
 * Every product claim Fusion makes in README / console docs, scored as:
 *   function — the surface exists (CLI, MCP, UI, types)
 *   value    — the behavior matches the promise
 * Source: README.md (2026-09). Local suite only — not CI.
 */

export type ClaimKind = "function" | "value";

export type Claim = {
  id: string;
  claim: string;
  source: string;
};

export const CLAIMS: Claim[] = [
  {
    id: "clients-four",
    claim: "One layer over Claude Code, Codex, Cursor, Hermes into Langfuse",
    source: "README opening",
  },
  {
    id: "capture-split",
    claim: "Claude Code and Codex share the OTLP bridge; Cursor and Hermes share the gateway",
    source: "README Today vs Fusion / Fusion Clients",
  },
  {
    id: "loopback",
    claim: "Fusion stays on this machine (127.0.0.1)",
    source: "README opening",
  },
  {
    id: "init-sinks",
    claim: "fusion init finds existing Langfuse, then use-local | use-cloud | docker-local | cloud | gateway-only",
    source: "README Setup step 1",
  },
  {
    id: "discover-no-hardcoded-port",
    claim: "Discover does not invent a Langfuse port; host --local is only for a stack Fusion starts",
    source: "README Setup / coverage noSinkDetail",
  },
  {
    id: "ports",
    claim: "up exposes UI/control :4599, gateway :4600, OTLP bridge :4318",
    source: "README Setup step 2",
  },
  {
    id: "cli-verbs",
    claim: "CLI offers init, host, up/down, enable/disable, project/route, connect, doctor/status, ui, config",
    source: "README Setup CLI",
  },
  {
    id: "enable-sources",
    claim: "fusion enable wires claude-code, codex, or hermes (Cursor is gateway, not enable)",
    source: "README Fusion Clients / Capture",
  },
  {
    id: "project-stamp",
    claim: ".fusion + hook (or gateway) stamp project= at the source; Fusion does not guess it later from the trace",
    source: "README Today vs Fusion",
  },
  {
    id: "coverage-states",
    claim: "Coverage is FLOWING / CONFIGURED / SUBSCRIPTION / BYPASSED / DOWN (and unknown when Langfuse cannot be queried)",
    source: "README MCP / UI",
  },
  {
    id: "subscription-not-failure",
    claim: "Cursor subscription is SUBSCRIPTION — normal, not a failure. BYOK gateway is the only Cursor path Fusion can see",
    source: "README Today vs Fusion",
  },
  {
    id: "flowing-is-presence",
    claim: "FLOWING means a recent tagged trace (service:<client>), not token volume",
    source: "README UI / coverage.ts",
  },
  {
    id: "doctor-vs-status",
    claim: "doctor checks the live pipeline (and can write keys); status is the same list without calling Langfuse",
    source: "README Capture / doctor.ts",
  },
  {
    id: "doctor-chain",
    claim: "doctor/console report daemon, gateway, bridge, Langfuse auth, who is wired",
    source: "README Today vs Fusion",
  },
  {
    id: "mcp-tools",
    claim: "Fusion MCP exposes the advertised fusion_* tools; same tools in Cursor and Hermes",
    source: "README Fusion MCP table",
  },
  {
    id: "keys-stay-in-fusion",
    claim: "Langfuse keys stay in Fusion config, not in editor MCP JSON or console HTML",
    source: "README MCP / schema orgSecretKey",
  },
  {
    id: "org-key-scope",
    claim: "Listing or governing org projects needs an organization-scoped key (Team/Enterprise)",
    source: "README MCP note / TargetSchema",
  },
  {
    id: "ui-board",
    claim: "fusion ui is one board: health, clients, routing, govern, docs",
    source: "README UI",
  },
  {
    id: "prices-openrouter-fallback",
    claim: "prices sync fetches OpenRouter and falls back to bundled values",
    source: "README MCP / UI",
  },
  {
    id: "govern-same-engine",
    claim: "CLI, MCP, and console govern actions share the same engine",
    source: "README Setup / mcp/server.ts",
  },
];

export const ADVERTISED_MCP_TOOLS = [
  "fusion_status",
  "fusion_coverage",
  "fusion_targets_list",
  "fusion_routes_list",
  "fusion_target_test",
  "fusion_project_link",
  "fusion_target_add",
  "fusion_target_set_keys",
  "fusion_set_active",
  "fusion_enable_source",
  "fusion_prices_sync",
] as const;

export const ADVERTISED_CLI = [
  "init",
  "host",
  "up",
  "down",
  "enable",
  "disable",
  "project",
  "project link",
  "route",
  "connect",
  "doctor",
  "status",
  "ui",
  "config",
] as const;

export const ADVERTISED_FLOW = ["flowing", "configured", "subscription", "bypassed", "down", "unknown"] as const;
