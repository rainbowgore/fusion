/** Operational timeouts and caps — one place, not scattered literals. */

export const COMPOSE_TIMEOUT_MS = 10 * 60_000;
export const BRIDGE_CMD_TIMEOUT_MS = 10 * 60_000;
export const NPX_MCP_TIMEOUT_MS = 5 * 60_000;
export const UI_POST_TIMEOUT_MS = 20_000;
export const HEALTH_FETCH_TIMEOUT_MS = 8_000;
export const CONTROL_JSON_MAX = 1_000_000;
export const HEARTBEAT_MS = 15_000;
export const HEARTBEAT_STALE_MS = 45_000;
export const LISTEN_PROBE_MS = 400;
export const LOCAL_HEALTH_PROBE_MS = 600;
export const CLOUD_HEALTH_PROBE_MS = 4000;
export const DOCKER_PS_TIMEOUT_MS = 6000;
