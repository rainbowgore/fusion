import { Command } from "commander";
import { registerConfigCommands } from "../../src/commands/config.ts";
import { registerInitCommand } from "../../src/commands/init.ts";
import { registerTargetCommands } from "../../src/commands/target.ts";
import { registerEnableCommand } from "../../src/commands/enable.ts";
import { registerDoctorCommands } from "../../src/commands/doctor.ts";
import { registerHostCommand } from "../../src/commands/host.ts";
import { registerLifecycleCommands } from "../../src/commands/lifecycle.ts";
import { registerPricesCommand } from "../../src/commands/prices.ts";
import { registerUiCommand } from "../../src/commands/ui.ts";
import { registerProjectCommands } from "../../src/commands/project.ts";
import { registerEnvCommands } from "../../src/commands/env.ts";
import { registerMcpCommands } from "../../src/commands/mcp.ts";
import { registerFaceCommands } from "../../src/commands/faces.ts";

export function buildCliProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("fusion");
  registerInitCommand(program);
  registerConfigCommands(program);
  registerTargetCommands(program);
  registerEnableCommand(program);
  registerDoctorCommands(program);
  registerHostCommand(program);
  registerLifecycleCommands(program);
  registerPricesCommand(program);
  registerUiCommand(program);
  registerProjectCommands(program);
  registerEnvCommands(program);
  registerMcpCommands(program);
  registerFaceCommands(program);
  return program;
}

export function listCliCommands(cmd: Command, prefix = ""): string[] {
  const names: string[] = [];
  for (const child of cmd.commands) {
    const n = prefix ? `${prefix} ${child.name()}` : child.name();
    names.push(n);
    names.push(...listCliCommands(child, n));
  }
  return names;
}
