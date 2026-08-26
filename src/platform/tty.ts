import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export function isInteractive(): boolean {
  return stdin.isTTY === true && stdout.isTTY === true;
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
