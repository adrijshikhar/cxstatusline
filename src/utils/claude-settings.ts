// Stub for upstream Claude settings; cxstatusline uses Codex adapter instead
export function loadClaudeSettingsSync(): any { return {}; }
export function getSandboxConfig(): any { return null; }
export function resolveClaudeConfigCwd(): string { return process.cwd(); }
export function getClaudeConfigDir(): string { return process.cwd(); }
