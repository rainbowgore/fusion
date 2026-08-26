import { findNearestDotfile } from "./dotfile.js";

export interface EffectiveRoute {
  project: string;
  target?: string;
  dir: string; // the directory whose .fusion supplied the route
}

/**
 * The effective route for a directory: the nearest `.fusion` walking up the tree
 * (most-specific directory wins). Returns null when no route governs the dir.
 */
export function effectiveRoute(dir: string): EffectiveRoute | null {
  const found = findNearestDotfile(dir);
  if (!found) return null;
  return { project: found.dotfile.project, target: found.dotfile.target, dir: found.dir };
}

/**
 * The OTEL_RESOURCE_ATTRIBUTES value a client should carry so it self-tags its
 * telemetry. The bridge maps `project` → a `project:<value>` trace tag.
 */
export function otelResourceAttributes(route: EffectiveRoute): string {
  const parts = [`project=${route.project}`];
  if (route.target) parts.push(`fusion.target=${route.target}`);
  return parts.join(",");
}
