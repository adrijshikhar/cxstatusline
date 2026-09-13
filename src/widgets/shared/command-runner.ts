import { spawnSync } from 'node:child_process';

import type { RenderContext } from '../../types/RenderContext';
import type { WidgetItem } from '../../types/Widget';

// The Codex host kills the whole renderer after 1000 ms and the bare renderer costs ~140 ms, so
// every custom command on a line shares what is left. Numbers are fixed by the Phase 1 spec.
export const DEFAULT_TIMEOUT_MS = 300;
export const MIN_TIMEOUT_MS = 50;
export const MAX_TIMEOUT_MS = 600;
export const RENDER_BUDGET_MS = 600;
export const MAX_OUTPUT_BYTES = 64 * 1024;

export interface CommandRequest {
    readonly command: string;
    readonly input: string;
    readonly timeoutMs: number;
    readonly cwd?: string | undefined;
}

export interface CommandResult {
    readonly status: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly errorCode?: string | undefined;
}

/** Injected into CustomCommandWidget so tests never spawn a process. */
export type CommandRunner = (request: CommandRequest) => CommandResult;

/** Production runner: the user's own command line through the platform shell, stderr discarded. */
export const spawnCommand: CommandRunner = ({ command, input, timeoutMs, cwd }) => {
    const result = spawnSync(command, {
        shell: true,
        input,
        cwd,
        env: process.env,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        encoding: 'utf8'
    });
    const error = result.error as NodeJS.ErrnoException | undefined;
    return {
        status: result.status,
        signal: result.signal,
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        errorCode: error?.code
    };
};

export function resolveTimeout(item: WidgetItem): number {
    const requested = item.timeout ?? DEFAULT_TIMEOUT_MS;
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, requested));
}

// One budget per render, keyed by the RenderContext object: every renderer process starts fresh,
// and the long-lived TUI process never executes commands so it never holds an entry.
const budgets = new WeakMap<object, { remaining: number }>();

/** Takes up to `wanted` ms from this render's shared budget; 0 once it is spent. */
export function takeBudget(context: RenderContext, wanted: number): number {
    const entry = budgets.get(context) ?? { remaining: RENDER_BUDGET_MS };
    const granted = Math.max(0, Math.min(wanted, entry.remaining));
    budgets.set(context, { remaining: entry.remaining - granted });
    return granted;
}

/** Refunds unused execution time to this render's budget (capped at RENDER_BUDGET_MS). */
export function refundBudget(context: RenderContext, unusedMs: number): void {
    const refund = Math.max(0, unusedMs);
    if (refund === 0) return;
    const entry = budgets.get(context) ?? { remaining: RENDER_BUDGET_MS };
    budgets.set(context, { remaining: Math.min(RENDER_BUDGET_MS, entry.remaining + refund) });
}

/** Upstream diagnostic token for a failed result, or null when the command succeeded. */
export function describeFailure(result: CommandResult): string | null {
    if (result.errorCode === 'ETIMEDOUT') return '[Timeout]';
    if (result.errorCode === 'ENOBUFS') return '[Error]';
    if (result.errorCode === 'ENOENT' || result.status === 127) return '[Cmd not found]';
    if (result.errorCode === 'EACCES') return '[Permission denied]';
    if (result.signal === 'SIGKILL') return '[Timeout]';
    if (result.signal) return `[Signal: ${result.signal}]`;
    if (result.status === null) return '[Error]';
    if (result.status !== 0) return `[Exit: ${result.status}]`;
    return null;
}
