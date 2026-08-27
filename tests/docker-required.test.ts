import assert from "node:assert/strict";
import { test } from "node:test";
import { dockerReady, dockerNotReadyReason, dockerRequiredForSink, type DockerStatus } from "../src/platform/docker.ts";

const ready: DockerStatus = {
  installed: true,
  daemonRunning: true,
  composeAvailable: true,
  version: "Docker version 28.0.0",
};

test("dockerReady requires CLI, daemon, and compose", () => {
  assert.equal(dockerReady(ready), true);
  assert.equal(dockerReady({ ...ready, installed: false, daemonRunning: false, composeAvailable: false }), false);
  assert.equal(dockerReady({ ...ready, daemonRunning: false, detail: "daemon down" }), false);
  assert.equal(dockerReady({ ...ready, composeAvailable: false }), false);
});

test("dockerNotReadyReason names the missing piece", () => {
  assert.equal(dockerNotReadyReason(ready), "");
  assert.match(
    dockerNotReadyReason({ installed: false, daemonRunning: false, composeAvailable: false, detail: "docker CLI not found on PATH" }),
    /CLI not found/,
  );
  assert.match(
    dockerNotReadyReason({ installed: true, daemonRunning: false, composeAvailable: true, detail: "docker daemon not reachable (is Docker Desktop running?)" }),
    /daemon/,
  );
  assert.match(dockerNotReadyReason({ ...ready, composeAvailable: false }), /compose/i);
});

test("Docker is required only for a local Langfuse sink", () => {
  assert.equal(dockerRequiredForSink("docker-local"), true);
  assert.equal(dockerRequiredForSink("cloud"), false);
  assert.equal(dockerRequiredForSink("gateway-only"), false);
  assert.equal(dockerRequiredForSink(undefined), false);
});
