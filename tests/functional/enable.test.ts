import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { enableClaudeCode, enableCodex, stripCodexBlock, CODEX_MARKER } from "../../src/sources/enable.ts";
import { enableHermes, disableHermes, type HermesRunner } from "../../src/sources/hermes.ts";
import { getOrCreateGatewayToken } from "../../src/core/auth.ts";
import {
  commandAvailable,
  createFunctionalEnv,
  recordAction,
  recordSkip,
  runCli,
} from "./setup.ts";

test("functional enable: claude-code writes env.sh with OTEL vars", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const endpoint = `http://127.0.0.1:${fx.ports.bridge}`;
    const r = enableClaudeCode(endpoint, false);
    assert.equal(r.ok, true, r.message);
    assert.ok(existsSync(r.file));
    const body = readFileSync(r.file, "utf8");
    assert.match(body, /# fusion:claude-code/);
    assert.match(body, /CLAUDE_CODE_ENABLE_TELEMETRY=1/);
    assert.match(body, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    recordAction("enable", "enableClaudeCode");

    const dis = await runCli(["disable", "claude-code"], fx.env);
    assert.equal(dis.status, 0, dis.stderr || dis.stdout);
    assert.equal(existsSync(r.file), false);
    recordAction("enable", "disable claude-code");
  } finally {
    await fx.close();
  }
});

test("functional enable: codex appends marked [otel] block and disable strips it", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const endpoint = `http://127.0.0.1:${fx.ports.bridge}`;
    const r = enableCodex(endpoint, true);
    assert.equal(r.ok, true, r.message);
    const before = readFileSync(fx.codexConfig, "utf8");
    assert.match(before, new RegExp(CODEX_MARKER));
    assert.match(before, /\[otel\]/);
    assert.match(before, /log_user_prompt = true/);
    recordAction("enable", "enableCodex");

    const dis = await runCli(["disable", "codex"], fx.env);
    assert.equal(dis.status, 0, dis.stderr || dis.stdout);
    const after = readFileSync(fx.codexConfig, "utf8");
    assert.equal(after.includes(CODEX_MARKER), false);
    recordAction("enable", "disable codex");
  } finally {
    await fx.close();
  }
});

test("functional enable: hermes via injected runner", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const store: Record<string, string> = {
      "model.provider": "openai",
      "model.base_url": "https://api.openai.com",
    };
    const run: HermesRunner = (args) => {
      if (args[0] === "config" && args[1] === "path") return { status: 0, stdout: join(fx.hermesHome, "config.yaml"), stderr: "" };
      if (args[0] === "config" && args[1] === "get") return { status: 0, stdout: store[args[2]] ?? "", stderr: "" };
      if (args[0] === "config" && args[1] === "set") {
        store[args[2]] = args[3] ?? "";
        writeFileSync(
          join(fx.hermesHome, "config.yaml"),
          `model:\n  provider: ${store["model.provider"]}\n  base_url: ${store["model.base_url"]}\n`,
          "utf8",
        );
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "unset") {
        delete store[args[2]];
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unknown ${args.join(" ")}` };
    };

    const token = getOrCreateGatewayToken();
    const en = enableHermes(fx.ports.gateway, token, run);
    assert.equal(en.ok, true, en.message);
    assert.ok(en.capture);
    assert.match(store["model.base_url"], /\/gw\/hermes/);
    recordAction("enable", "enableHermes (mock runner)");

    const dis = disableHermes(en.capture, run);
    assert.equal(dis.ok, true, dis.message);
    assert.equal(store["model.base_url"], "https://api.openai.com");
    recordAction("enable", "disableHermes (mock runner)");
  } finally {
    await fx.close();
  }
});

test("functional enable: uninstall strips Fusion marks", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    enableCodex(`http://127.0.0.1:${fx.ports.bridge}`, false);
    assert.match(readFileSync(fx.codexConfig, "utf8"), new RegExp(CODEX_MARKER));

    const r = await runCli(["uninstall"], fx.env, 90_000);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const after = readFileSync(fx.codexConfig, "utf8");
    assert.equal(after.includes(CODEX_MARKER), false);
    // stripCodexBlock sanity
    assert.equal(stripCodexBlock(after).changed, false);
    recordAction("enable", "uninstall");
  } finally {
    await fx.close();
  }
});

test("functional enable: real CLI smoke if installed", async (t) => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    if (commandAvailable("claude")) {
      const en = await runCli(["enable", "claude-code"], fx.env);
      assert.equal(en.status, 0, en.stderr || en.stdout);
      recordAction("enable", "real claude enable smoke");
      await runCli(["disable", "claude-code"], fx.env);
    } else if (commandAvailable("codex")) {
      const en = await runCli(["enable", "codex"], fx.env);
      assert.equal(en.status, 0, en.stderr || en.stdout);
      recordAction("enable", "real codex enable smoke");
      await runCli(["disable", "codex"], fx.env);
    } else if (commandAvailable("hermes")) {
      const en = await runCli(["enable", "hermes"], fx.env);
      if (en.status === 0) {
        recordAction("enable", "real hermes enable smoke");
        await runCli(["disable", "hermes"], fx.env);
      } else {
        recordSkip("enable", "real hermes enable smoke", en.stderr || en.stdout);
        t.skip(en.stderr || en.stdout);
      }
    } else {
      recordSkip("enable", "real client enable/run/disable", "no claude/codex/hermes CLI");
      t.skip("no claude/codex/hermes CLI installed");
    }
  } finally {
    await fx.close();
  }
});
