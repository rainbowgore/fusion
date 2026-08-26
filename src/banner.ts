/**
 * Fusion welcome banner — same language as the console: black/white, no teal.
 * Color only on a TTY when NO_COLOR is unset.
 */

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

const ink = (s: string) => c("38;2;255;255;255", s);
const dim = (s: string) => c("38;2;160;160;160", s);
const faint = (s: string) => c("38;2;90;90;90", s);

const ART = [
  "███████╗██╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗",
  "██╔════╝██║   ██║██╔════╝██║██╔═══██╗████╗  ██║",
  "█████╗  ██║   ██║███████╗██║██║   ██║██╔██╗ ██║",
  "██╔══╝  ██║   ██║╚════██║██║██║   ██║██║╚██╗██║",
  "██║     ╚██████╔╝███████║██║╚██████╔╝██║ ╚████║",
  "╚═╝      ╚═════╝ ╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝",
];

export function banner(version: string): string {
  const lines: string[] = [""];
  for (const l of ART) lines.push("  " + ink(l));
  lines.push("");
  lines.push("  " + dim("THE UNIFIED GOVERNANCE LAYER FOR LANGFUSE"));
  lines.push("  " + ink("capture anywhere · govern routing · automate config") + faint("  v" + version));
  lines.push("");
  lines.push("  " + faint("─".repeat(60)));
  lines.push("  " + dim("GET STARTED"));
  lines.push("    " + ink("fusion init") + faint("                                 ") + dim("find existing Langfuse, then choose how traces land"));
  lines.push("    " + ink("fusion host --local") + faint("                                 ") + dim("after choosing Docker local"));
  lines.push("    " + ink("fusion enable claude-code") + faint("  |  ") + ink("codex") + faint("               ") + dim("wire a client"));
  lines.push("    " + ink("fusion project link <dir> --to <project>") + faint("           ") + dim("govern a directory"));
  lines.push("    " + ink("fusion ui") + faint("                                     ") + dim("coverage, routing, health"));
  lines.push("");
  lines.push("  " + faint("fusion --help  ·  fusion doctor"));
  lines.push("");
  return lines.join("\n");
}
