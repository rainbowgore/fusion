#!/usr/bin/env node
import { Command } from "commander";
import { banner } from "./banner.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerInitCommand } from "./commands/init.js";
import { registerTargetCommands } from "./commands/target.js";
import { registerEnableCommand } from "./commands/enable.js";
import { registerDoctorCommands } from "./commands/doctor.js";
import { registerHostCommand } from "./commands/host.js";
import { registerLifecycleCommands } from "./commands/lifecycle.js";
import { registerPricesCommand } from "./commands/prices.js";
import { registerUiCommand } from "./commands/ui.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerEnvCommands } from "./commands/env.js";
import { registerMcpCommands } from "./commands/mcp.js";
import { registerFaceCommands } from "./commands/faces.js";

const program = new Command();

program
  .name("fusion")
  .description(
    "The unified governance layer for Langfuse (local + cloud).\n" +
      "Capture from any AI coding client, govern where activity lands (directory→project\n" +
      "routing), and automate the Langfuse config — CLI + local dashboard on one engine.",
  )
  .version("0.0.0");

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

// Bare `fusion` (no subcommand) → branded welcome instead of a wall of help.
if (process.argv.length <= 2) {
  console.log(banner("0.0.0"));
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
