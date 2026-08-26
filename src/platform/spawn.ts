import { spawn, type SpawnOptions } from "node:child_process";

/** Spawn and resolve the exit code. Kill on timeout (124). */
export function spawnExit(
  cmd: string,
  args: string[],
  opts: SpawnOptions & { timeoutMs?: number } = {},
): Promise<number> {
  const { timeoutMs, ...spawnOpts } = opts;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, spawnOpts);
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill("SIGTERM");
            } catch {
              /* gone */
            }
            finish(124);
          }, timeoutMs)
        : undefined;
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code ?? 1));
  });
}
