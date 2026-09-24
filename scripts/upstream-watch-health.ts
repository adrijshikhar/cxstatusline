import { appendFileSync } from "node:fs";
import { execGh, ghJson, type GhRunner } from "./prebuilt/gh";
import { repoSlug } from "./prebuilt/env";

export const WATCHDOG_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export interface WatchRun {
  readonly event: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly updated_at: string;
}

export function checkWatcherHeartbeat(runs: readonly WatchRun[], now = Date.now()): { readonly healthy: boolean; readonly ageMs: number | null; readonly detail: string } {
  const latest = runs.filter((run) => run.event === "schedule" && run.status === "completed" && run.conclusion === "success")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  if (!latest) return { healthy: false, ageMs: null, detail: "No successful scheduled upstream watcher run was found." };
  const timestamp = Date.parse(latest.updated_at);
  if (!Number.isFinite(timestamp)) return { healthy: false, ageMs: null, detail: "The latest successful scheduled watcher run has an invalid timestamp." };
  const ageMs = Math.max(0, now - timestamp);
  const healthy = ageMs <= WATCHDOG_MAX_AGE_MS;
  return { healthy, ageMs, detail: healthy
    ? `Latest successful scheduled watcher run is ${Math.floor(ageMs / 3_600_000)} hours old.`
    : `Latest successful scheduled watcher run is older than 36 hours (${Math.floor(ageMs / 3_600_000)} hours).` };
}

export function readWatcherHeartbeat(run: GhRunner, repo: string): WatchRun[] {
  const result = ghJson<{ workflow_runs: WatchRun[] }>(run, [
    "api", `repos/${repo}/actions/workflows/upstream-watch.yml/runs?event=schedule&status=success&per_page=100`,
  ]);
  if (!Array.isArray(result.workflow_runs)) throw new Error("Actions API did not return workflow_runs");
  return result.workflow_runs;
}

if (import.meta.main) {
  try {
    const repoIndex = process.argv.indexOf("--repo");
    const repo = repoSlug(repoIndex < 0 ? {} : { repo: process.argv[repoIndex + 1] ?? "" });
    const result = checkWatcherHeartbeat(readWatcherHeartbeat(execGh, repo));
    const line = `${result.healthy ? "✅" : "❌"} ${result.detail}`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Upstream watcher health\n\n${line}\n`);
    console.log(result.detail);
    if (!result.healthy) {
      console.error(`::error::${result.detail}`);
      process.exitCode = 1;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`::error::Upstream watcher health check failed: ${detail}`);
    process.exitCode = 1;
  }
}
