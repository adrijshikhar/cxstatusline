import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const supported = process.platform !== "win32";
const ptyAvailable = supported && spawnSync("python3", ["-c", "import pty, termios, select"], { encoding: "utf8" }).status === 0;
let tempDir = "";
let bundle = "";

beforeAll(() => {
  if (!ptyAvailable) return;
  tempDir = mkdtempSync(join(tmpdir(), "cx-tui-pty-"));
  const entry = join(tempDir, "fixture.ts");
  bundle = join(tempDir, "fixture.mjs");
  const source = resolve(import.meta.dir, "../src");
  writeFileSync(entry, `
    import { spawnSync } from "node:child_process";
    import { promptCodexVersion } from ${JSON.stringify(join(source, "ui/prompt-version.ts"))};
    import { promptUpdate } from ${JSON.stringify(join(source, "ui/UpdatePicker.tsx"))};
    import { createInstallProgressTracker } from ${JSON.stringify(join(source, "ui/progress.ts"))};
    const mode = process.argv[2];
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (mode === "workflow") {
      console.log("MARKER BEFORE PICKER");
      const versions = ["0.155.1", ...Array.from({ length: 13 }, (_, i) => "0.14" + i + ".0")];
      const selected = await promptCodexVersion({ supportedVersions: versions, prebuiltVersions: versions, defaultVersion: versions.at(-1), isTTY: true });
      console.log("INSTALL=" + JSON.stringify(selected));
      const progress = createInstallProgressTracker({ isTTY: true, stdout: process.stdout, say: console.log });
      progress.transport.onProgress?.(512, 1024);
      await pause(80);
      progress.transport.onStatus?.("download-done", "Verified smoke archive");
      progress.finish();
      console.log("COMPLETION DURABLE");
      const handoff = spawnSync(process.execPath, ["-e", "console.log('HANDOFF isTTY=' + process.stdin.isTTY + ' raw=' + process.stdin.isRaw)"], { stdio: "inherit" });
      console.log("HANDOFF EXIT=" + handoff.status);
      console.log("UPDATE=" + await promptUpdate({ latest: "0.156.1", highestAvailable: "0.155.1" }));
      console.log("MARKER AFTER UPDATE");
    } else if (mode === "interrupt") {
      const progress = createInstallProgressTracker({ isTTY: true, stdout: process.stdout, say: console.log });
      progress.transport.onProgress?.(512, 1024);
      await pause(10000);
      progress.finish();
    } else if (mode === "failure") {
      const progress = createInstallProgressTracker({ isTTY: true, stdout: process.stdout, say: console.log });
      try {
        progress.transport.onProgress?.(512, 1024);
        await pause(80);
        throw new Error("fixture acquisition failure");
      } catch (error) {
        progress.finish();
        console.log("EXPECTED ERROR=" + error.message);
      }
    } else if (mode === "small") {
      try {
        const selected = await promptCodexVersion({ supportedVersions: ["0.155.1"], isTTY: true });
        console.log("UNEXPECTED SMALL SELECTION=" + JSON.stringify(selected));
      } catch (error) {
        console.log("SMALL ERROR=" + error.message);
      }
    }
  `);
  const result = spawnSync("bun", ["build", entry, "--target=node", `--outfile=${bundle}`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
});

afterAll(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

test.skipIf(!supported || !ptyAvailable)("Node PTY preserves prompt/progress history, handles resize and cancellation, and restores terminal mode", () => {
  const python = String.raw`
import fcntl, json, os, pty, select, signal, struct, sys, termios, time
bundle = sys.argv[1]
def run(mode):
    pid, fd = pty.fork()
    if pid == 0:
        env = dict(os.environ, TERM='xterm-256color')
        env.pop('CI', None)
        os.execvpe('node', ['node', bundle, mode], env)
    initial_size = (12, 30) if mode == 'small' else (24, 80)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', initial_size[0], initial_size[1], 0, 0))
    os.kill(pid, signal.SIGWINCH)
    events = [{'resize': [initial_size[1], initial_size[0]]}]
    output = bytearray(); sent = set(); deadline = time.time() + 12; status = None
    restore_offset = None; navigation_offset = None; small_offset = None
    def wait_raw(timeout=2):
        ready_by = time.time() + timeout
        while termios.tcgetattr(fd)[3] & termios.ICANON and time.time() < ready_by:
            if select.select([fd], [], [], .05)[0]:
                chunk = os.read(fd, 65536)
                output.extend(chunk); events.append({'data': chunk.decode(errors='replace')})
        # Raw mode belongs to the parent Ink app; allow the newly mounted
        # list's passive input subscription to settle after its first frame.
        time.sleep(.1)
        return not (termios.tcgetattr(fd)[3] & termios.ICANON)
    while time.time() < deadline:
        if select.select([fd], [], [], .05)[0]:
            try:
                chunk = os.read(fd, 65536)
                output.extend(chunk)
                events.append({'data': chunk.decode(errors='replace')})
            except OSError: break
        transcript = output.decode(errors='replace')
        if mode == 'workflow' and 'Select Codex version' in transcript and 'install-nav' not in sent:
            assert wait_raw(), 'install prompt did not enable raw input: ' + transcript
            navigation_offset = len(output)
            os.write(fd, b'\x1b[B')
            sent.add('install-nav')
        if mode == 'workflow' and 'install-nav' in sent and 'install-small' not in sent and navigation_offset is not None:
            navigated = output[navigation_offset:].decode(errors='replace')
            if '▶  0.155.1' in navigated:
                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 12, 30, 0, 0))
                os.kill(pid, signal.SIGWINCH)
                events.append({'resize': [30, 12]})
                sent.add('install-small')
                small_offset = len(output)
        if mode == 'workflow' and 'install-small' in sent and 'small-enter' not in sent and small_offset is not None:
            small_view = output[small_offset:].decode(errors='replace')
            if 'Resize terminal to' in small_view:
                assert 'INSTALL=' not in transcript, 'small view accepted a selection'
                sent.add('small-enter')
                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 20, 48, 0, 0))
                os.kill(pid, signal.SIGWINCH)
                events.append({'resize': [48, 20]})
                restore_offset = len(output)
        if mode == 'workflow' and 'small-enter' in sent and 'install-ready' not in sent and restore_offset is not None:
            restored = output[restore_offset:].decode(errors='replace')
            if 'Select Codex version' in restored and '▶  0.155.1' in restored:
                assert wait_raw(), 'install picker did not restore raw input: ' + restored
                os.write(fd, b'\r')
                sent.add('install-ready')
        if mode == 'workflow' and 'How would you like to proceed?' in transcript and 'update-ready' not in sent:
            assert wait_raw(), 'update prompt did not enable raw input: ' + transcript
            os.write(fd, b'\x1b'); sent.add('update-ready')
        if mode == 'interrupt' and '50%' in transcript and 'interrupt' not in sent:
            os.write(fd, b'\x03'); sent.add('interrupt')
        done, status = os.waitpid(pid, os.WNOHANG)
        if done: break
        status = None
    if status is None:
        done, status = os.waitpid(pid, os.WNOHANG)
        if not done:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            raise AssertionError('PTY timeout (' + mode + '): ' + output.decode(errors='replace'))
    cooked = bool(termios.tcgetattr(fd)[3] & termios.ICANON)
    os.close(fd)
    text = output.decode(errors='replace')
    capture_path = os.environ.get('CX_TUI_CAPTURE_EVENTS')
    if mode == 'workflow' and capture_path:
        os.makedirs(os.path.dirname(capture_path), exist_ok=True)
        with open(capture_path, 'w', encoding='utf8') as capture:
            json.dump(events, capture)
    code = os.waitstatus_to_exitcode(status)
    assert cooked, 'terminal left in raw mode (' + mode + ')'
    assert '\x1b[2J' not in text and '\x1b[3J' not in text, 'Ink cleared screen or scrollback (' + mode + ')'
    if mode == 'workflow':
        assert code == 0, text
        for expected in ['MARKER BEFORE PICKER', 'INSTALL={"version":"0.155.1","compile":false}', '50%', 'Verified smoke archive', 'COMPLETION DURABLE', 'HANDOFF isTTY=true raw=false', 'UPDATE=cancel', 'MARKER AFTER UPDATE']:
            assert expected in text, (expected, text)
        assert text.index('COMPLETION DURABLE') < text.index('How would you like to proceed?')
        assert 'install-ready' in sent and 'update-ready' in sent
    elif mode == 'interrupt':
        assert code in (-signal.SIGINT, 130), (code, text)
        assert 'interrupt' in sent
    elif mode == 'failure':
        assert code == 0 and 'EXPECTED ERROR=fixture acquisition failure' in text, (code, text)
    else:
        assert code == 0 and 'SMALL ERROR=Terminal must be at least 40 columns' in text, (code, text)
        assert 'UNEXPECTED SMALL SELECTION' not in text
    return code, cooked, len(text)
for mode in ('small', 'workflow', 'interrupt', 'failure'):
    print('PASS', mode, run(mode))
`;
  const result = spawnSync("python3", ["-c", python, bundle], { encoding: "utf8", timeout: 45000 });
  if (result.error) throw result.error;
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain("PASS workflow");
  expect(result.stdout).toContain("PASS interrupt");
  expect(result.stdout).toContain("PASS failure");
}, 60_000);
