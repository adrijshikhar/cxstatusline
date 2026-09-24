#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE = "Usage: seo-drift <baseline|compare> [url]";
export const DEFAULT_URL = "http://127.0.0.1:4321";

export function resolveClaudeSeoPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  const envPath = env.CLAUDE_SEO_PATH;
  if (envPath && envPath.trim().length > 0) {
    return envPath;
  }
  const aimPath = join(
    home,
    ".aim/profiles/bot/.agents/skills/seo/scripts/claude-seo"
  );
  if (existsSync(aimPath)) {
    return aimPath;
  }
  const geminiProfilePath = join(
    home,
    ".aim/profiles/rs/.gemini/config/skills/seo/scripts/claude-seo"
  );
  if (existsSync(geminiProfilePath)) {
    return geminiProfilePath;
  }
  const claudePath = join(
    home,
    ".claude/skills/seo/scripts/claude-seo"
  );
  if (existsSync(claudePath)) {
    return claudePath;
  }
  return aimPath;
}

export interface ExecuteDriftOptions {
  claudeSeoPath?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
}

export function executeDrift(
  args: readonly string[],
  options: ExecuteDriftOptions = {}
): number {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  const action = args[0];
  if (!action || (action !== "baseline" && action !== "capture" && action !== "compare")) {
    console.error(`Invalid action: "${action ?? ""}"\n${USAGE}`);
    return 1;
  }

  const script = action === "compare" ? "drift_compare.py" : "drift_baseline.py";
  const remaining = args.slice(1);
  const urlIndex = remaining.findIndex((arg) => !arg.startsWith("-"));
  const rawUrl = urlIndex !== -1 ? remaining[urlIndex] : undefined;
  const targetUrl = rawUrl ?? DEFAULT_URL;
  const url = targetUrl.startsWith("http://") || targetUrl.startsWith("https://") ? targetUrl : `http://${targetUrl}`;
  const extraArgs = urlIndex !== -1 ? remaining.filter((_, idx) => idx !== urlIndex) : remaining;

  const claudeSeoPath = options.claudeSeoPath ?? resolveClaudeSeoPath(options.env);
  if (!existsSync(claudeSeoPath)) {
    console.error(
      `Error: claude-seo runner not found at "${claudeSeoPath}". Please ensure the seo skill is installed or set CLAUDE_SEO_PATH.`
    );
    return 1;
  }

  const runnerArgs = ["run", script, "--skip-cwv", url, ...extraArgs];
  const env: Record<string, string | undefined> = { ...(options.env ?? process.env) };
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      const target = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      const existing = env.CLAUDE_SEO_LOCAL_TARGETS ? env.CLAUDE_SEO_LOCAL_TARGETS.split(",") : [];
      if (!existing.includes(target)) {
        env.CLAUDE_SEO_LOCAL_TARGETS = [...existing, target].filter(Boolean).join(",");
      }
    }
  } catch {
    // Ignore URL parse error, runner will report invalid URLs
  }

  const result = spawnSync(claudeSeoPath, runnerArgs, {
    stdio: options.stdio ?? "inherit",
    env,
  });

  if (result.error) {
    console.error(`Execution error: ${result.error.message}`);
    return 1;
  }

  const exitCode = result.status ?? (result.signal ? 1 : 0);
  return exitCode;
}

if (import.meta.main) {
  const code = executeDrift(process.argv.slice(2), { stdio: "inherit" });
  process.exit(code);
}
