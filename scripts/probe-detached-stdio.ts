/**
 * Probe proving the binding constraint in spec §3.2:
 *
 * A parent process waiting for EOF on child stdout will:
 * - Reach clean EOF quickly if grandchild uses stdio: 'ignore' (measured: ~11 ms).
 * - Time out (>= 1000 ms) without reaching EOF if grandchild uses stdio: 'inherit' (measured: ~1004 ms),
 *   because the detached grandchild keeps the inherited write end of the pipe open.
 *
 * In Codex, this would cause the 1s timeout to fire and discard the entire statusline render.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const role = process.argv.find(arg => arg.startsWith('--role='))?.split('=')[1];
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1] ?? 'ignore';

if (role === 'grandchild') {
    // Grandchild sleeps for 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    process.exit(0);
}

if (role === 'child') {
    // Child spawns a 3-second grandchild, prints one line, and exits immediately
    const stdioMode = mode === 'inherit' ? 'inherit' : 'ignore';
    spawn(process.execPath, [filename, '--role=grandchild'], {
        detached: true,
        stdio: stdioMode
    }).unref();

    console.log('child ready');
    process.exit(0);
}

// Parent harness
interface ProbeResult {
    mode: 'ignore' | 'inherit';
    reachedEof: boolean;
    elapsedMs: number;
    output: string;
}

function runProbe(probeMode: 'ignore' | 'inherit'): Promise<ProbeResult> {
    return new Promise((resolve) => {
        const start = Date.now();
        const child = spawn(process.execPath, [filename, '--role=child', `--mode=${probeMode}`], {
            stdio: ['ignore', 'pipe', 'ignore']
        });

        let output = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill();
                resolve({
                    mode: probeMode,
                    reachedEof: false,
                    elapsedMs: Date.now() - start,
                    output
                });
            }
        }, 1000);

        child.stdout?.on('data', (chunk) => {
            output += chunk.toString();
        });

        child.stdout?.on('end', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve({
                    mode: probeMode,
                    reachedEof: true,
                    elapsedMs: Date.now() - start,
                    output
                });
            }
        });

        child.on('error', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve({
                    mode: probeMode,
                    reachedEof: false,
                    elapsedMs: Date.now() - start,
                    output
                });
            }
        });
    });
}

console.log('Running probe for detached grandchild stdio modes...');
const ignoreResult = await runProbe('ignore');
console.log(`- 'ignore': reached EOF = ${ignoreResult.reachedEof}, elapsed = ${ignoreResult.elapsedMs}ms`);

const inheritResult = await runProbe('inherit');
console.log(`- 'inherit': reached EOF = ${inheritResult.reachedEof}, elapsed = ${inheritResult.elapsedMs}ms`);

if (!ignoreResult.reachedEof || ignoreResult.elapsedMs >= 1000) {
    console.error(`FAILURE: 'ignore' did not reach EOF under 1000ms (reached: ${ignoreResult.reachedEof}, elapsed: ${ignoreResult.elapsedMs}ms)`);
    process.exit(1);
}

if (inheritResult.reachedEof && inheritResult.elapsedMs < 1000) {
    console.error(`FAILURE: 'inherit' unexpectedly reached EOF under 1000ms! (reached: ${inheritResult.reachedEof}, elapsed: ${inheritResult.elapsedMs}ms)`);
    console.error('Spec §3.2 contradicted: grandchild with inherited stdout did not hold pipe open.');
    process.exit(1);
}

console.log('SUCCESS: spec §3.2 confirmed: stdio: "ignore" reaches EOF quickly, while "inherit" keeps pipe open.');
