import { COMPOSE_TIMEOUT_MS } from "./limits.js";
import { spawnExit } from "./spawn.js";

/** Runs `docker compose <args>` in cwd, streaming output. Resolves exit code. */
export function compose(cwd: string, args: string[], timeoutMs = COMPOSE_TIMEOUT_MS): Promise<number> {
  return spawnExit("docker", ["compose", ...args], { cwd, stdio: "inherit", timeoutMs });
}
