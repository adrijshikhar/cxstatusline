/**
 * Single-quote a string for POSIX `sh` (and for `shlex::split` on the Rust side).
 * One definition on purpose: the wrapper script and the hooks.json command string must quote
 * identically, or the hook's recorded command drifts from the wrapper's and Codex re-prompts for
 * trust (the trust hash covers the command text).
 */
export const sq = (s: string): string => `'${s.replace(/'/g, `'"'"'`)}'`;
