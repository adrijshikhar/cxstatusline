import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Get package version
// __PACKAGE_VERSION__ will be replaced at build time
const PACKAGE_VERSION = '__PACKAGE_VERSION__';

export function getPackageVersion(): string {
    // If we have the build-time replaced version, use it (check if it looks like a version)
    if (/^\d+\.\d+\.\d+/.test(PACKAGE_VERSION)) {
        return PACKAGE_VERSION;
    }

    // Fallback for development mode
    const possiblePaths = [
        path.join(__dirname, '..', '..', 'package.json'), // Development: dist/utils/ -> root
        path.join(__dirname, '..', 'package.json')       // Production: dist/ -> root (bundled)
    ];

    for (const packageJsonPath of possiblePaths) {
        try {
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
                return packageJson.version ?? '';
            }
        } catch {
            // Continue to next path
        }
    }

    return '';
}

function probeTerminalWidth(): number | null {
    // Preserve historical behavior on Windows: width detection is unavailable.
    // This avoids Unix fallback command behavior (e.g. 2>/dev/null) on Windows.
    if (typeof process === 'undefined' || process.platform === 'win32') {
        return null;
    }

    // Codex/Claude Code can spawn statusline with piped stdio, leaving the immediate
    // parent process without a controlling TTY. Walk up a few ancestors until we
    // find the shell process that owns the real PTY.
    let pid = process.pid;
    for (let depth = 0; depth < 8; depth += 1) {
        const parentPid = getParentProcessId(pid);
        if (parentPid === null) {
            break;
        }

        pid = parentPid;

        const tty = getTTYForProcess(pid);
        if (tty === null) {
            continue;
        }

        const width = getWidthForTTY(tty);
        if (width !== null) {
            return width;
        }
    }

    // Fallback: try tput cols which might work in some environments
    try {
        const width = execFileSync('tput', ['cols'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true
        }).trim();

        return parsePositiveInteger(width);
    } catch {
        // tput also failed
    }

    return null;
}

function parsePositiveInteger(value: string): number | null {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function getParentProcessId(pid: number): number | null {
    try {
        const parentPidOutput = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true
        }).trim();

        return parsePositiveInteger(parentPidOutput);
    } catch {
        return null;
    }
}

function getTTYForProcess(pid: number): string | null {
    try {
        const tty = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true
        }).replace(/\s+/g, '');

        if (!tty || tty === '??' || tty === '?') {
            return null;
        }

        return tty;
    } catch {
        return null;
    }
}

function getWidthForTTY(tty: string): number | null {
    // The shell-redirect form (`stty size < /dev/${tty}`) fails with ENOTTY
    // when the calling process has no controlling terminal — the case under
    // Claude Code >= 2.1.139, which spawns statusline/hooks without terminal
    // access. `stty -F` / `-f` ask stty to open the device itself (with
    // O_NOCTTY semantics) and succeed regardless of controlling-tty status.
    const devicePath = `/dev/${tty}`;
    const attempts: string[][] = [
        ['-F', devicePath, 'size'],   // GNU coreutils (Linux)
        ['-f', devicePath, 'size']    // BSD stty (macOS, *BSD)
    ];

    for (const args of attempts) {
        try {
            const output = execFileSync('stty', args, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true
            }).trim();

            const parsed = parsePositiveInteger(output.split(/\s+/)[1] ?? '');
            if (parsed !== null) {
                return parsed;
            }
        } catch {
            // try next strategy
        }
    }

    return null;
}

let hasProbed = false;
let cachedWidth: number | null = null;
let lastProbeTime = 0;

/** Clear the memoized width. For tests, and for the TUI to re-probe after a resize. */
export function resetTerminalWidthCache(): void {
    hasProbed = false;
    cachedWidth = null;
    lastProbeTime = 0;
}

// Invalidate cache on terminal resize events
if (typeof process !== 'undefined' && typeof process.stdout?.on === 'function') {
    process.stdout.on('resize', () => {
        resetTerminalWidthCache();
    });
}
if (typeof process !== 'undefined' && process.platform !== 'win32' && typeof process.on === 'function') {
    process.on('SIGWINCH', () => {
        resetTerminalWidthCache();
    });
}

export interface TerminalWidthOptions {
    sessionId?: string;
    ttlSeconds?: number;
}

// Get terminal width
export function getTerminalWidth(options?: TerminalWidthOptions): number | null {
    // Explicit override. Useful when cxstatusline/ccstatusline is spawned in a context where
    // no ancestor process owns a TTY at all.
    const overrideRaw = typeof process !== 'undefined'
        ? (process.env.CXSTATUSLINE_WIDTH ?? process.env.CCSTATUSLINE_WIDTH)
        : undefined;
    if (overrideRaw) {
        const override = parsePositiveInteger(overrideRaw);
        if (override !== null) {
            return override;
        }
    }

    const ttlSeconds = options?.ttlSeconds ?? 5;
    const now = Date.now();

    // If ttlSeconds > 0, check if we have a valid cached result within TTL
    if (ttlSeconds > 0 && hasProbed) {
        if (now - lastProbeTime <= ttlSeconds * 1000) {
            return cachedWidth;
        }
    }

    cachedWidth = probeTerminalWidth();
    hasProbed = true;
    lastProbeTime = now;

    return cachedWidth;
}

// Check if terminal width detection is available
export function canDetectTerminalWidth(): boolean {
    return getTerminalWidth() !== null;
}
