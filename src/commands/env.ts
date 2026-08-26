import type { Command } from "commander";
import { effectiveRoute } from "../routing/resolve.js";
import { loadConfig } from "../config/load.js";

/**
 * The injection surface. `fusion env` resolves the nearest `.fusion` and prints
 * the OTEL_RESOURCE_ATTRIBUTES a client should carry; `fusion hook` prints a shell
 * snippet that applies it on directory change.
 *
 * Security: the value is single-quote shell-escaped so a hostile `.fusion`
 * (`project="x; rm -rf ~"`) cannot execute when the hook `eval`s the line.
 * It MERGES project/target into any existing OTEL_RESOURCE_ATTRIBUTES instead of
 * clobbering the user's other attributes.
 */
export function registerEnvCommands(program: Command): void {
  program
    .command("env [dir]")
    .description("Print OTEL_RESOURCE_ATTRIBUTES for the nearest .fusion route (default: cwd)")
    .option("--export", "Emit a shell-eval-safe `export`/`unset` line for the hook", false)
    .action((dir: string | undefined, opts: Record<string, unknown>) => {
      const route = effectiveRoute(dir ?? process.cwd());
      // Precedence: a directory (.fusion) rule wins; else fall back to the config's
      // defaultProject (the "client default"). No rule at all → clear Fusion's attrs.
      let project = route?.project;
      let target = route?.target;
      if (!project) {
        try {
          const dp = loadConfig().defaultProject;
          if (dp) project = dp;
        } catch {
          /* no config yet — no default */
        }
      }

      // Merge: keep the user's own attrs, replace only Fusion's project/target keys.
      const existing = process.env.OTEL_RESOURCE_ATTRIBUTES ?? "";
      const kept = existing
        .split(",")
        .map((s) => s.trim())
        .filter((p) => p && !/^project=/.test(p) && !/^fusion\.target=/.test(p));
      const add = project ? [`project=${project}`, ...(target ? [`fusion.target=${target}`] : [])] : [];
      const merged = [...kept, ...add].join(",");

      if (opts.export) {
        console.log(merged ? `export OTEL_RESOURCE_ATTRIBUTES=${shellQuote(merged)}` : `unset OTEL_RESOURCE_ATTRIBUTES`);
      } else if (merged) {
        console.log(`OTEL_RESOURCE_ATTRIBUTES=${merged}`);
      } else {
        console.log("# no .fusion route or default project governs this directory");
      }
    });

  program
    .command("hook <shell>")
    .description("Print a shell hook (bash | zsh) that applies the .fusion route on directory change")
    .action((shell: string) => {
      if (shell !== "bash" && shell !== "zsh") {
        console.error(`Unsupported shell "${shell}". Use bash or zsh.`);
        process.exit(1);
      }
      console.log(shellHook(shell));
    });
}

/** POSIX single-quote escaping: wrap in '…', and encode embedded quotes as '\''. */
function shellQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`;
}

function shellHook(shell: "bash" | "zsh"): string {
  const fn =
    `# Fusion routing hook — apply the nearest .fusion project on directory change.\n` +
    `# Add to your ~/.${shell}rc:  eval "$(fusion hook ${shell})"\n` +
    `_fusion_apply() {\n` +
    `  eval "$(fusion env --export 2>/dev/null)"\n` +
    `}\n`;
  if (shell === "zsh") {
    // chpwd already fires only on directory change.
    return fn + `autoload -Uz add-zsh-hook\nadd-zsh-hook chpwd _fusion_apply\n_fusion_apply\n`;
  }
  // bash: guard on $PWD so it only runs when the directory actually changed.
  return (
    fn +
    `_fusion_cd_guard() { if [ "$PWD" != "$_FUSION_LAST_PWD" ]; then _FUSION_LAST_PWD="$PWD"; _fusion_apply; fi; }\n` +
    `case ";\${PROMPT_COMMAND:-};" in *";_fusion_cd_guard;"*) ;; *) PROMPT_COMMAND="_fusion_cd_guard;\${PROMPT_COMMAND:-}";; esac\n` +
    `_fusion_apply\n`
  );
}
