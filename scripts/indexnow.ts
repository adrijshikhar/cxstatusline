#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_HOST = "cxstatusline.adrijshikhar.dev";
export const DEFAULT_KEY = "1303670a09c5d783e567987aef292217";
export const DEFAULT_KEY_LOCATION = `https://${DEFAULT_HOST}/${DEFAULT_KEY}.txt`;
export const DEFAULT_URL = `https://${DEFAULT_HOST}/`;

export function resolveClaudeSeoPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  const envPath = env.CLAUDE_SEO_PATH;
  if (envPath && envPath.trim().length > 0) {
    return envPath;
  }
  const candidates = [
    join(home, ".gemini/config/skills/seo/scripts/claude-seo"),
    join(home, ".gemini/config/plugins/agents-skills/skills/seo/scripts/claude-seo"),
    join(home, ".agents/skills/seo/scripts/claude-seo"),
    join(home, ".claude/skills/seo/scripts/claude-seo"),
    join(home, ".aim/profiles/bot/.agents/skills/seo/scripts/claude-seo"),
    join(home, ".aim/profiles/rs/.gemini/config/skills/seo/scripts/claude-seo"),
    join(home, ".aim/profiles/work/.gemini/config/skills/seo/scripts/claude-seo"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export interface ExecuteIndexNowOptions {
  claudeSeoPath?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
}

export function executeIndexNow(
  args: readonly string[] = [],
  options: ExecuteIndexNowOptions = {}
): number {
  const claudeSeoPath = options.claudeSeoPath ?? resolveClaudeSeoPath(options.env);
  if (!existsSync(claudeSeoPath)) {
    console.error(
      `Error: claude-seo runner not found at "${claudeSeoPath}". Please ensure the seo skill is installed or set CLAUDE_SEO_PATH.`
    );
    return 1;
  }

  const hasHost = args.includes("--host");
  const hasKey = args.includes("--key");
  const hasKeyLoc = args.includes("--key-location");
  const hasUrls = args.includes("--urls") || args.includes("--urls-file");

  const runnerArgs = [
    "run",
    "indexnow_submit.py",
    ...(hasHost ? [] : ["--host", DEFAULT_HOST]),
    ...(hasKey ? [] : ["--key", DEFAULT_KEY]),
    ...(hasKeyLoc ? [] : ["--key-location", DEFAULT_KEY_LOCATION]),
    ...(hasUrls ? [] : ["--urls", DEFAULT_URL]),
    ...args,
  ];

  const result = spawnSync(claudeSeoPath, runnerArgs, {
    stdio: options.stdio ?? "inherit",
    env: { ...(options.env ?? process.env) },
  });

  if (result.error) {
    console.error(`Execution error: ${result.error.message}`);
    return 1;
  }

  return result.status ?? (result.signal ? 1 : 0);
}

if (import.meta.main) {
  const code = executeIndexNow(process.argv.slice(2), { stdio: "inherit" });
  process.exit(code);
}
