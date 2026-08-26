/**
 * Starter config. No Langfuse host is invented here — a target is added when
 * the user runs `fusion host --local` or `fusion target add` / init cloud.
 */
export const DEFAULT_CONFIG_TOML = `# Fusion config — unified governance layer for Langfuse
# Edit by hand or via \`fusion target ...\` / \`fusion enable ...\`.
# Do not put a Langfuse URL here. Fusion does not know where the user's
# Langfuse lives until they save a target (any host they actually use).

activeTarget = ""

[ports]
ui = 3006
bridge = 4318

[sources]
"claude-code" = false
codex = false
cursor = false
hermes = false
`;
