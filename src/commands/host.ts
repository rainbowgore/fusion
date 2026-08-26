import type { Command } from "commander";
import { loadConfig, saveConfig } from "../config/load.js";
import { detectDocker } from "../platform/docker.js";
import { findFreePort } from "../platform/net.js";
import { compose } from "../platform/compose.js";
import { applyStackToConfig, discardNewStackMeta, LOCAL_STACK_TARGET, FUSION_MANAGED_LANGFUSE_BIND, readStackInfo, writeFusionRuntimeEnv, writeStack, syncUnifiedCompose } from "../langfuse/stack.js";
import { discoverAndRemember } from "../langfuse/discover.js";
import { LangfuseClient } from "../langfuse/client.js";

/**
 * `fusion host --local`: create the machine-local Docker Langfuse stack, or
 * attach to the one already on this machine (same compose project + keys).
 */
export function registerHostCommand(program: Command): void {
  program
    .command("host")
    .description("Create or continue Fusion's machine-local Langfuse in Docker")
    .option("--local", "Run the local Docker Langfuse stack", false)
    .option("--name <name>", "Target name to register", LOCAL_STACK_TARGET)
    .option("--no-wait", "Don't wait for the stack to become healthy")
    .action(async (opts: Record<string, unknown>) => {
      if (!opts.local) {
        console.error("Only `fusion host --local` is supported. Pass --local to run the Docker stack.");
        process.exit(1);
      }

      const docker = await detectDocker();
      if (!docker.daemonRunning) {
        console.error(`Docker is required for local Langfuse (${docker.detail ?? "the daemon isn't running"}).`);
        console.error("Start Docker Desktop and retry.");
        process.exit(1);
      }
      if (!docker.composeAvailable) {
        console.error("`docker compose` is not available. Fusion's local Langfuse stack needs Compose v2.");
        process.exit(1);
      }

      const cfg = loadConfig();
      const found = await discoverAndRemember(cfg, { scanListen: true });
      const already = found.find((d) => d.kind === "local" && d.healthy);
      const existing = readStackInfo();
      if (!existing && already) {
        console.log(`Local Langfuse is already up at ${already.host}. Fusion will use that instance.`);
        console.log("Not starting a second Fusion-managed stack.");
        if (cfg.sink === "docker-local") cfg.sink = "cloud";
        saveConfig(cfg);
        console.log("Next: `fusion up` (OTLP bridge → that host).");
        return;
      }
      let info = existing;
      if (info) {
        console.log(`Continuing existing Fusion Langfuse stack at ${info.dir} (${info.host}).`);
      } else {
        const preferred = cfg.ports.langfuseWeb ?? FUSION_MANAGED_LANGFUSE_BIND;
        const webPort = await findFreePort(preferred);
        if (webPort !== preferred) {
          console.log(`Port ${preferred} is busy — Fusion's managed Langfuse web will bind :${webPort}.`);
        }
        info = writeStack(webPort);
        console.log(`Created Fusion Langfuse stack at ${info.dir} (Langfuse web → ${info.host}).`);
      }
      syncUnifiedCompose(info.dir);
      writeFusionRuntimeEnv(cfg);
      console.log("Pulling images and starting containers (first run can take a few minutes)…");

      const code = await compose(info.dir, ["up", "-d"]);
      if (code !== 0) {
        if (!existing) discardNewStackMeta(info.dir);
        console.error(`docker compose up failed (exit ${code}).`);
        process.exit(code);
      }

      if (opts.wait !== false) {
        const ok = await waitForHealth(info.host, 180_000);
        if (!ok) {
          console.error("Langfuse did not become healthy in time. Check `docker compose logs` in the stack dir.");
          process.exit(1);
        }
        console.log("✓ Langfuse is healthy.");
      }

      const targetName = String(opts.name || LOCAL_STACK_TARGET);
      applyStackToConfig(cfg, info, targetName);
      saveConfig(cfg);

      console.log(`\n${existing ? "Attached" : "Registered"} managed target "${targetName}" (now active).`);
      console.log(`Langfuse UI: ${info.host}  (login admin@fusion.local — see .env in the stack dir)`);
      console.log("Next: `fusion up` (bridge) · `fusion prices sync` · `fusion enable claude-code`.");
    });
}

async function waitForHealth(host: string, timeoutMs: number): Promise<boolean> {
  const client = new LangfuseClient({ host, publicKey: "", secretKey: "" });
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("Waiting for Langfuse health");
  while (Date.now() < deadline) {
    const v = await client.validate();
    if (v.health === "ok") {
      process.stdout.write("\n");
      return true;
    }
    process.stdout.write(".");
    await sleep(3000);
  }
  process.stdout.write("\n");
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
