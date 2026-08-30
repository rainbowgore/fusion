import { z } from "zod";

/**
 * Fusion config schema.
 *
 * One config defines *targets* (where the data lives — a local Docker Langfuse
 * and/or Langfuse Cloud projects), the enabled *sources* (which AI coding tools
 * we ingest), and *ports* (local UI + ingestion bridge). CLI and UI both read this.
 */

export const TargetKind = z.enum(["local", "cloud"]);
export type TargetKind = z.infer<typeof TargetKind>;

export const TargetSchema = z.object({
  /** Unique, human-friendly identifier used by `fusion target use <name>`. */
  name: z.string().min(1),
  /** local = self-hosted Docker Langfuse; cloud = a Langfuse Cloud project. */
  kind: TargetKind,
  /** Base URL of a real Langfuse instance (set when the user adds a target). */
  host: z.string().url(),
  /** Langfuse project public key (pk-lf-...). */
  publicKey: z.string().default(""),
  /** Langfuse project secret key (sk-lf-...). Prefer sourcing from 1Password. */
  secretKey: z.string().default(""),
  /**
   * Organization-scoped public key (Organization Settings → API Keys).
   * Required for Fusion MCP on Cursor/Hermes to list and govern org projects.
   */
  orgPublicKey: z.string().default(""),
  /** Organization-scoped secret key. Never written into editor MCP JSON. */
  orgSecretKey: z.string().default(""),
  /** Langfuse project name/slug this target reports against. */
  project: z.string().default("default"),
  /**
   * Tier 1 marker: true when Fusion runs the local Docker Langfuse stack for
   * this target (fusion host --local). false = Tier 0, the user points at an
   * existing Langfuse (cloud or self-run) and Fusion only reads it.
   */
  managed: z.boolean().default(false),
});
export type Target = z.infer<typeof TargetSchema>;

export const SourcesSchema = z
  .object({
    "claude-code": z.boolean().default(false),
    codex: z.boolean().default(false),
    cursor: z.boolean().default(false),
    hermes: z.boolean().default(false),
  })
  .default({ "claude-code": false, codex: false, cursor: false, hermes: false });
export type Sources = z.infer<typeof SourcesSchema>;

export const PortsSchema = z
  .object({
    /** Local governance console (Fusion UI). */
    ui: z.number().int().positive().default(3006),
    /** OTLP ingestion bridge (receives Claude Code + Codex telemetry). */
    bridge: z.number().int().positive().default(4318),
    /** Host bind for a Langfuse stack Fusion itself starts (`fusion host --local`).
     *  Not the user's existing Langfuse — that host is only whatever they save on a target. */
    langfuseWeb: z.number().int().positive().optional(),
    /** The core daemon's control/API + dashboard port. */
    daemon: z.number().int().positive().default(4599),
    /** The model gateway (universal capture chokepoint) port. */
    gateway: z.number().int().positive().default(4600),
  })
  .default({ ui: 3006, bridge: 4318, daemon: 4599, gateway: 4600 });
export type Ports = z.infer<typeof PortsSchema>;

/**
 * A governance route: a directory linked to a project (and optionally a specific
 * target). Fusion's central registry mirrors the thin `.fusion` pointer written
 * into each linked directory; central config stays the authority for targets/keys.
 */
export const LinkSchema = z.object({
  dir: z.string().min(1), // absolute path
  project: z.string().min(1),
  target: z.string().optional(),
});
export type Link = z.infer<typeof LinkSchema>;

/**
 * A registered client endpoint (Claude Code, Codex, Cursor, a generic client).
 * `capture` records how its activity reaches Fusion; `provider`/`upstream` power
 * gateway forwarding for BYOK clients.
 */
/** How Fusion intercepts Hermes: shape of the HTTP API + the real upstream. */
export const HermesCaptureSchema = z.object({
  shape: z.enum(["openai", "anthropic"]),
  upstream: z.string().min(1),
  previousProvider: z.string().default(""),
  previousBaseUrl: z.string().default(""),
});
export type HermesCapture = z.infer<typeof HermesCaptureSchema>;

export const EndpointSchema = z.object({
  name: z.string().min(1),
  client: z.enum(["claude-code", "codex", "cursor", "hermes", "generic"]).default("generic"),
  capture: z.enum(["gateway", "otlp", "both", "none"]).default("none"),
  /** Upstream provider base URL the gateway forwards to (BYOK). */
  upstream: z.string().url().optional(),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

export const ConfigSchema = z
  .object({
    /** Config schema version (for future migrations). */
    version: z.number().int().positive().default(1),
    /** Name of the target commands run against by default. */
    activeTarget: z.string().default(""),
    targets: z.array(TargetSchema).default([]),
    sources: SourcesSchema,
    ports: PortsSchema,
    /** Directory→project route registry (governance). */
    links: z.array(LinkSchema).default([]),
    /** Registered client endpoints (capture mechanism + routing). */
    endpoints: z.array(EndpointSchema).default([]),
    /** Fallback project when no directory (.fusion) rule matches. Directory wins. */
    defaultProject: z.string().optional(),
    /** Set by `fusion enable hermes` so the gateway speaks the right API. */
    hermesCapture: HermesCaptureSchema.optional(),
    /** Set by `fusion init`: docker-local | cloud | gateway-only. */
    sink: z.enum(["docker-local", "cloud", "gateway-only"]).optional(),
  })
  .passthrough()
  .superRefine((cfg, ctx) => {
    // No hardcoded "reserved" ports (that would leak one machine's setup into the
    // shipped defaults). Occupied ports are handled at runtime by free-port
    // selection + the daemon's EADDRINUSE guard. We only reject internal collisions.
    // No two of the local ports may share a value.
    const portPairs: Array<[string, number]> = [
      ["ui", cfg.ports.ui],
      ["bridge", cfg.ports.bridge],
      ["daemon", cfg.ports.daemon],
      ["gateway", cfg.ports.gateway],
    ];
    if (cfg.ports.langfuseWeb != null) portPairs.push(["langfuseWeb", cfg.ports.langfuseWeb]);
    for (let i = 0; i < portPairs.length; i++) {
      for (let j = i + 1; j < portPairs.length; j++) {
        if (portPairs[i][1] === portPairs[j][1]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ports", portPairs[j][0]],
            message: `ports.${portPairs[j][0]} (${portPairs[j][1]}) collides with ports.${portPairs[i][0]}`,
          });
        }
      }
    }
    // activeTarget must resolve to a defined target (when any exist).
    if (cfg.targets.length > 0 && !cfg.targets.some((t) => t.name === cfg.activeTarget)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeTarget"],
        message: `activeTarget "${cfg.activeTarget}" does not match any defined target`,
      });
    }
    // Target names must be unique.
    const seen = new Set<string>();
    for (const [i, t] of cfg.targets.entries()) {
      if (seen.has(t.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", i, "name"],
          message: `duplicate target name "${t.name}"`,
        });
      }
      seen.add(t.name);
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
