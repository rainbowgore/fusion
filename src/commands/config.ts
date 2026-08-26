import type { Command } from "commander";
import { stringify as stringifyToml } from "smol-toml";
import { loadConfig, ConfigError } from "../config/load.js";
import { configPath } from "../config/paths.js";

/** `fusion config path|show` — inspect the config. (`init` lives in init.ts.) */
export function registerConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("Inspect the Fusion config");

  config
    .command("path")
    .description("Print the resolved config file path")
    .action(() => {
      console.log(configPath());
    });

  config
    .command("show")
    .description("Load, validate, and print the current config")
    .action(() => {
      try {
        const cfg = loadConfig();
        console.log(stringifyToml(cfg));
      } catch (err) {
        if (err instanceof ConfigError) {
          console.error(err.message);
          process.exit(1);
        }
        throw err;
      }
    });
}
