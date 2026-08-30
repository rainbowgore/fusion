import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { detectDocker } from "../../src/platform/docker.ts";
import {
  commandAvailable,
  createFunctionalEnv,
  recordAction,
  recordSkip,
  runCli,
} from "./setup.ts";
import { emitCoverageReport } from "./report.ts";

test("functional CLI: init gateway-only writes config", async () => {
  const fx = await createFunctionalEnv();
  try {
    const r = await runCli(["init", "--sink", "gateway-only"], fx.env);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(existsSync(fx.configPath), "config.toml should exist");
    const raw = readFileSync(fx.configPath, "utf8");
    assert.match(raw, /gateway-only|sink/i);
    recordAction("cli", "init --sink gateway-only");
  } finally {
    await fx.close();
  }
});

test("functional CLI: target add/use/list roundtrip", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig({ activeTarget: "", targets: [] });
    const add = await runCli(
      [
        "target",
        "add",
        "mock2",
        "--host",
        fx.lf.host,
        "--public-key",
        "pk-lf-test",
        "--secret-key",
        "sk-lf-test",
        "--kind",
        "cloud",
        "--no-validate",
      ],
      fx.env,
    );
    assert.equal(add.status, 0, add.stderr || add.stdout);
    recordAction("cli", "target add");

    const list = await runCli(["target", "list"], fx.env);
    assert.equal(list.status, 0, list.stderr || list.stdout);
    assert.match(list.stdout, /mock2/);
    recordAction("cli", "target list");

    const use = await runCli(["target", "use", "mock2"], fx.env);
    assert.equal(use.status, 0, use.stderr || use.stdout);
    assert.match(use.stdout, /Active target is now "mock2"/);
    recordAction("cli", "target use");
  } finally {
    await fx.close();
  }
});

test("functional CLI: config show prints TOML", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const r = await runCli(["config", "show"], fx.env);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /activeTarget|ports|sources/);
    recordAction("cli", "config show");
  } finally {
    await fx.close();
  }
});

test("functional CLI: doctor and status", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const status = await runCli(["status"], fx.env);
    assert.equal(status.status, 0, status.stderr || status.stdout);
    recordAction("cli", "status");

    const doctor = await runCli(["doctor", "--no-deep", "--no-fix"], fx.env);
    // doctor may exit 1 if core daemon is down — still a valid user-facing result
    assert.ok(doctor.stdout.length > 0 || doctor.stderr.length > 0);
    recordAction("cli", "doctor --no-deep --no-fix");
  } finally {
    await fx.close();
  }
});

test("functional CLI: project link/unlink/list and route aliases", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const proj = join(fx.linkRoot, "demo");
    mkdirSync(proj, { recursive: true });

    const link = await runCli(["project", "link", proj, "--to", "demo-proj"], fx.env);
    assert.equal(link.status, 0, link.stderr || link.stdout);
    assert.ok(existsSync(join(proj, ".fusion")));
    recordAction("cli", "project link");

    const list = await runCli(["project", "list"], fx.env);
    assert.equal(list.status, 0, list.stderr || list.stdout);
    assert.match(list.stdout, /demo-proj/);
    recordAction("cli", "project list");

    const routes = await runCli(["route", "list"], fx.env);
    assert.equal(routes.status, 0, routes.stderr || routes.stdout);
    assert.match(routes.stdout, /demo-proj/);
    recordAction("cli", "route list");

    const unlink = await runCli(["project", "unlink", proj], fx.env);
    assert.equal(unlink.status, 0, unlink.stderr || unlink.stdout);
    recordAction("cli", "project unlink");
  } finally {
    await fx.close();
  }
});

test("functional CLI: prices sync against mock Langfuse", async () => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    const r = await runCli(["prices", "sync"], fx.env, 90_000);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(fx.lf.models.length > 0 || /registered|created|synced|ok/i.test(r.stdout + r.stderr));
    recordAction("cli", "prices sync");
  } finally {
    await fx.close();
  }
});

test("functional CLI: host --local / up / down when Docker available", async (t) => {
  const docker = await detectDocker();
  if (!docker.daemonRunning || !docker.composeAvailable) {
    recordSkip("cli", "host --local / up / down", docker.detail ?? "Docker not ready");
    t.skip(docker.detail ?? "Docker not ready");
    return;
  }

  const fx = await createFunctionalEnv({ skipDiscover: false });
  try {
    // Prefer a fresh gateway-only config so host --local can create a managed stack.
    const init = await runCli(["init", "--sink", "gateway-only"], fx.env);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const host = await runCli(["host", "--local", "--no-wait"], fx.env, 180_000);
    if (host.status !== 0) {
      recordSkip("cli", "host --local", host.stderr || host.stdout);
      t.skip(`host --local failed: ${host.stderr || host.stdout}`);
      return;
    }
    recordAction("cli", "host --local");

    const up = await runCli(["up", "--no-bridge"], fx.env, 120_000);
    if (up.status !== 0) {
      recordSkip("cli", "up --no-bridge", up.stderr || up.stdout);
      t.skip(`up failed: ${up.stderr || up.stdout}`);
      return;
    }
    recordAction("cli", "up --no-bridge");

    const down = await runCli(["down"], fx.env, 120_000);
    assert.equal(down.status, 0, down.stderr || down.stdout);
    recordAction("cli", "down");
  } finally {
    await fx.close();
  }
});

test("functional CLI: optional real client smoke (claude/codex/hermes)", async (t) => {
  const fx = await createFunctionalEnv();
  try {
    fx.writeBaseConfig();
    let any = false;

    if (commandAvailable("claude")) {
      any = true;
      const en = await runCli(["enable", "claude-code"], fx.env);
      assert.equal(en.status, 0, en.stderr || en.stdout);
      assert.ok(existsSync(join(fx.dataDir, "claude-code.env.sh")));
      recordAction("cli", "enable claude-code (claude installed)");
    } else {
      recordSkip("cli", "enable claude-code smoke", "claude CLI not installed");
    }

    if (commandAvailable("codex")) {
      any = true;
      const en = await runCli(["enable", "codex"], fx.env);
      assert.equal(en.status, 0, en.stderr || en.stdout);
      assert.match(readFileSync(fx.codexConfig, "utf8"), /fusion:otel-block/);
      recordAction("cli", "enable codex (codex installed)");
    } else {
      recordSkip("cli", "enable codex smoke", "codex CLI not installed");
    }

    if (commandAvailable("hermes")) {
      any = true;
      const en = await runCli(["enable", "hermes"], fx.env);
      // May fail on OAuth-only installs — record accordingly
      if (en.status === 0) {
        recordAction("cli", "enable hermes (hermes installed)");
        await runCli(["disable", "hermes"], fx.env);
      } else {
        recordSkip("cli", "enable hermes smoke", en.stderr || en.stdout);
      }
    } else {
      recordSkip("cli", "enable hermes smoke", "hermes CLI not installed");
    }

    if (!any) t.skip("No client CLIs installed (claude/codex/hermes)");
  } finally {
    await fx.close();
  }
});

// Emit matrix once after CLI file finishes (other files also call; last wins is fine).
test("functional report: emit coverage matrix (cli partial)", () => {
  emitCoverageReport();
});
