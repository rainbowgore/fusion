import type { Config, Target } from "../config/schema.js";

export function targetIsStub(t: Target): boolean {
  return !t.publicKey?.trim() || !t.secretKey?.trim();
}

/** Plain picture for MCP clients. Fusion never invents a local Langfuse host. */
export function langfusePicture(cfg: Config): {
  sink: string;
  active: string;
  summary: string;
  cloudProjects: Array<{ name: string; host: string; project: string }>;
  targets: Array<{
    name: string;
    kind: string;
    host: string;
    project: string;
    managed: boolean;
      hasKeys: boolean;
      hasOrgKeys: boolean;
      stub: boolean;
      active: boolean;
  }>;
  directoryRoutes: number;
} {
  const sink = cfg.sink ?? "unset";
  const cloud = cfg.targets.filter((t) => t.kind === "cloud" && !targetIsStub(t));
  const lines: string[] = [];

  if (sink === "gateway-only") {
    lines.push("Fusion is gateway-only: capture can run without a Langfuse instance on this machine.");
  } else if (sink === "docker-local") {
    lines.push(
      "Fusion is set to a Langfuse stack Fusion started in Docker (the recorded host is that stack’s bind, not a guess at some other local Langfuse).",
    );
  } else if (sink === "cloud") {
    lines.push("Fusion is set to Langfuse Cloud.");
  } else {
    lines.push("No sink chosen yet.");
  }

  lines.push(
    "Fusion discovers Langfuse from Docker, MCP config, env, and local processes that answer Langfuse health. Local ports are not hardcoded.",
  );

  if (cloud.length === 0) {
    lines.push(
      "There is no Langfuse Cloud target with keys. Fusion cannot list cloud projects until Cloud host + keys are saved on a target.",
    );
  } else {
    const orgReady = cloud.some((t) => Boolean(t.orgPublicKey?.trim() && t.orgSecretKey?.trim()));
    lines.push(
      `Cloud targets: ${cloud.map((t) => `${t.name} (${t.host}, project ${t.project})`).join("; ")}.`,
    );
    lines.push(
      orgReady
        ? "Organization-scoped key is set; Fusion MCP can list and govern org projects."
        : "No organization-scoped key. fusion connect cursor|hermes needs LANGFUSE_ORG_PUBLIC_KEY and LANGFUSE_ORG_SECRET_KEY to answer org-wide questions.",
    );
  }

  if (cfg.links.length === 0) {
    lines.push(
      "No directory→project routes yet. That is Fusion routing, not a list of Langfuse Cloud projects.",
    );
  }

  return {
    sink,
    active: cfg.activeTarget,
    summary: lines.join(" "),
    cloudProjects: cloud.map((t) => ({ name: t.name, host: t.host, project: t.project })),
    targets: cfg.targets.map((t) => ({
      name: t.name,
      kind: t.kind,
      host: t.host,
      project: t.project,
      managed: t.managed,
      hasKeys: !targetIsStub(t),
      hasOrgKeys: Boolean(t.orgPublicKey?.trim() && t.orgSecretKey?.trim()),
      stub: targetIsStub(t),
      active: t.name === cfg.activeTarget,
    })),
    directoryRoutes: cfg.links.length,
  };
}
