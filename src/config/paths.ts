import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves Fusion's config location, honoring $XDG_CONFIG_HOME and an explicit
 * $FUSION_CONFIG override (handy for tests and alternate profiles).
 */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "fusion");
}

export function configPath(): string {
  const override = process.env.FUSION_CONFIG;
  if (override && override.trim() !== "") return override;
  return join(configDir(), "config.toml");
}
