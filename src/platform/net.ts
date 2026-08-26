import { Socket } from "node:net";

/**
 * Returns the first free TCP port at/after `preferred` on 127.0.0.1. Free =
 * nothing accepts a connection. Adapts to whatever is actually occupied on this
 * machine instead of hardcoding "reserved" ports.
 */
export async function findFreePort(preferred: number, maxTries = 50): Promise<number> {
  for (let p = preferred; p < preferred + maxTries; p++) {
    if (!(await tcpProbe("127.0.0.1", p, 300))) return p;
  }
  throw new Error(`no free port found in [${preferred}, ${preferred + maxTries})`);
}

/** Resolves true if a TCP connection to host:port opens within timeoutMs. */
export function tcpProbe(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}
