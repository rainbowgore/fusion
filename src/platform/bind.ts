const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Loopback only, unless FUSION_BIND_UNSAFE=1. */
export function resolveBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.FUSION_BIND ?? "").trim() || "127.0.0.1";
  if (LOOPBACK.has(raw)) return raw === "localhost" ? "127.0.0.1" : raw;
  if (env.FUSION_BIND_UNSAFE === "1") return raw;
  throw new Error(
    `FUSION_BIND=${raw} is not loopback. Fusion stays on this machine. Set FUSION_BIND_UNSAFE=1 only if you accept LAN exposure.`,
  );
}
