const KEEP = /^(PATH|HOME|USER|LOGNAME|TMPDIR|TMP|TEMP|PWD|SHELL|TERM|COLORTERM|LANG|LANGUAGE|LC_.*|XDG_.*|FUSION_.*|NODE_.*|npm_.*)$/;

/** Env for detached Fusion processes: keep runtime vars, drop the parent shell's unrelated secrets. */
export function filteredSpawnEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (v == null) continue;
    if (KEEP.test(k)) out[k] = v;
  }
  return out;
}
