import { existsSync, statSync } from "node:fs";
import { parse as parsePath, resolve, sep } from "node:path";

/** Resolve a directory Fusion may stamp. Refuse filesystem root and optional FUSION_LINK_ROOT escape. */
export function assertLinkableDir(dir: string, env: NodeJS.ProcessEnv = process.env): string {
  const abs = resolve(dir);
  const root = parsePath(abs).root;
  if (abs === root) throw new Error("refusing to link the filesystem root");
  const confine = (env.FUSION_LINK_ROOT ?? "").trim();
  if (confine) {
    const base = resolve(confine);
    if (abs !== base && !abs.startsWith(base.endsWith(sep) ? base : base + sep)) {
      throw new Error(`directory is outside FUSION_LINK_ROOT (${base})`);
    }
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`not a directory: ${abs}`);
  }
  return abs;
}
