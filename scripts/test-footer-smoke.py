#!/usr/bin/env python3
"""Exercise the patched Codex footer in an isolated, deterministic PTY session."""

from __future__ import annotations

import argparse
import codecs
import fcntl
import json
import os
import pathlib
import pty
import select
import shlex
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time

import pyte


ROWS = ("FOOTER_SMOKE_ALPHA", "FOOTER_SMOKE_BRAVO", "FOOTER_SMOKE_CHARLIE")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", required=True, type=pathlib.Path, help="explicit Codex executable")
    parser.add_argument("--expected-version", required=True, help="expected upstream Codex version")
    parser.add_argument("--patch-version", required=True, type=int, choices=(1, 2))
    parser.add_argument("--timeout", type=float, default=45.0)
    args = parser.parse_args()
    codex = args.codex.resolve(strict=True)
    if not os.access(codex, os.X_OK):
        raise SystemExit(f"Codex executable is not executable: {codex}")
    version = subprocess.run([str(codex), "--version"], check=True, text=True, capture_output=True).stdout.strip()
    if version != f"codex-cli {args.expected_version}":
        raise AssertionError(f"wrong Codex executable: expected codex-cli {args.expected_version}, got {version!r}")

    with tempfile.TemporaryDirectory(prefix="cx-footer-smoke-") as temp:
        root = pathlib.Path(temp)
        root = root.resolve()
        home = root / "home"
        codex_home = root / "codex-home"
        home.mkdir()
        codex_home.mkdir()
        config = (
            'openai_base_url = "http://127.0.0.1:9/v1"\n'
            '[tui]\nstatus_line = ["model"]\nshow_tooltips = false\n\n'
            f"[projects.{json.dumps(str(root))}]\ntrust_level = \"trusted\"\n"
        )
        (codex_home / "config.toml").write_text(config, encoding="utf-8")
        # A fake stored key skips first-run onboarding. The smoke never submits a prompt, and the
        # child inherits no real credentials or network configuration.
        (codex_home / "auth.json").write_text('{"OPENAI_API_KEY":"sk-test"}\n', encoding="utf-8")
        renderer = root / "renderer.py"
        counter = root / "render-count"
        renderer.write_text(
            "#!/usr/bin/env python3\n"
            "import pathlib, sys\n"
            f"counter = pathlib.Path({str(counter)!r})\n"
            "count = int(counter.read_text()) + 1 if counter.exists() else 1\n"
            "counter.write_text(str(count))\n"
            "sys.stdin.read()\n"
            f"print('{ROWS[0]} refresh=' + str(count))\n"
            f"print('{ROWS[1]}')\n"
            f"print('{ROWS[2]}')\n",
            encoding="utf-8",
        )
        renderer.chmod(0o755)

        pid, fd = pty.fork()
        if pid == 0:
            env = os.environ.copy()
            env.update(
                {
                    "HOME": str(home),
                    "CODEX_HOME": str(codex_home),
                    "CXSTATUSLINE_COMMAND": shlex.join([str(renderer)]),
                    "TERM": "xterm-256color",
                    "COLORTERM": "truecolor",
                    "COLUMNS": "100",
                    "LINES": "28",
                    "NO_COLOR": "1",
                    "UPDATE_INSTRUCTIONS_FILE": str(root / "no-update-instructions"),
                }
            )
            for credential in ("OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"):
                env.pop(credential, None)
            os.chdir(root)
            trust_override = f"projects.{json.dumps(str(root))}.trust_level=\"trusted\""
            os.execve(str(codex), [str(codex), "--no-alt-screen", "-c", trust_override], env)

        width, height = 100, 28
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
        screen = pyte.Screen(width, height)
        stream = pyte.Stream(screen)
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        raw_output: list[bytes] = []
        deadline = time.monotonic() + args.timeout

        def pump(seconds: float) -> None:
            until = min(time.monotonic() + seconds, deadline)
            while time.monotonic() < until:
                ready, _, _ = select.select([fd], [], [], max(0, min(0.1, until - time.monotonic())))
                if not ready:
                    continue
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    return
                if not data:
                    return
                raw_output.append(data)
                if b"\x1b[6n" in data:
                    os.write(fd, b"\x1b[1;1R")
                if b"\x1b[c" in data:
                    os.write(fd, b"\x1b[?1;2c")
                if b"\x1b[>c" in data or b"\x1b[>0c" in data:
                    os.write(fd, b"\x1b[>0;136;0c")
                if b"\x1b[?u" in data:
                    os.write(fd, b"\x1b[?0u")
                for color, value in ((10, b"ffff/ffff/ffff"), (11, b"0000/0000/0000")):
                    if b"\x1b]" + str(color).encode() + b";?" in data:
                        os.write(fd, b"\x1b]" + str(color).encode() + b";rgb:" + value + b"\x1b\\")
                stream.feed(decoder.decode(data))
            if time.monotonic() >= deadline:
                raise TimeoutError(f"test exceeded {args.timeout} seconds")

        def current_text() -> str:
            return "\n".join(line.rstrip() for line in screen.display)

        def assert_footer(stage: str, expect_draft: str | None = None) -> str:
            display = [line.rstrip() for line in screen.display]
            locations = [next((i for i, line in enumerate(display) if marker in line), None) for marker in ROWS]
            if any(location is None for location in locations) or len(set(locations)) != 3:
                waited, status = os.waitpid(pid, os.WNOHANG)
                tail = b"".join(raw_output)[-3000:].decode("utf-8", errors="replace")
                raise AssertionError(f"{stage}: footer rows missing or overlapped: {locations}; child={waited}, child_status={status}\n{current_text()}\nPTY tail:\n{tail!r}")
            if locations != sorted(locations):
                raise AssertionError(f"{stage}: footer rows reordered: {locations}\n{current_text()}")
            if expect_draft and expect_draft not in current_text():
                raise AssertionError(f"{stage}: draft not visible: {expect_draft!r}\n{current_text()}")
            if screen.cursor.y >= locations[0]:
                raise AssertionError(f"{stage}: input cursor overlaps footer: {screen.cursor}\n{current_text()}")
            print(json.dumps({"stage": stage, "footer_rows": locations, "cursor": [screen.cursor.x, screen.cursor.y]}))
            return current_text()

        def resize(new_width: int, new_height: int) -> None:
            nonlocal width, height
            width, height = new_width, new_height
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
            screen.resize(lines=height, columns=width)

        try:
            # Initial startup may include a one-time migration notice; allow the TUI and renderer
            # to settle before asserting the persistent footer.
            pump(8)
            assert_footer("idle")

            draft = "footer-smoke-draft"
            os.write(fd, draft.encode())
            pump(1)
            assert_footer("draft-typing", draft)

            os.write(fd, b"\x15")  # Ctrl+U clears the draft.
            pump(0.5)
            os.write(fd, b"/m")
            pump(1)
            # v1 intentionally replaces the footer with popup content. v2 gives the footer
            # its own region; changing historical v1 rendering would be a forbidden backport.
            menu = assert_footer("slash-menu-open", "/m") if args.patch_version == 2 else current_text()
            if args.patch_version == 1 and any(row in menu for row in ROWS):
                raise AssertionError(f"v1 popup did not replace the footer as expected\n{menu}")
            if menu.count("/model") < 2:
                raise AssertionError(f"slash command menu did not expose /model\n{menu}")

            os.write(fd, b"\x1b")  # Escape closes suggestions but leaves the draft intact.
            pump(0.5)
            closed = assert_footer("slash-menu-closed", "/m")
            if closed.count("/model") > 1:
                raise AssertionError(f"slash command menu remained visible after Escape\n{closed}")
            os.write(fd, b"\x15")
            pump(0.5)

            before = counter.read_text() if counter.exists() else "0"
            resize(36, 18)
            pump(1)
            assert_footer("narrow-resize")
            resize(120, 32)
            pump(1)
            assert_footer("wide-resize")

            # Input-driven redraws ask the renderer for a fresh snapshot. The changing first-row
            # token makes refresh observable without a backend request or live credentials.
            os.write(fd, b"x")
            pump(2)
            refreshed = assert_footer("refresh", "x")
            after = counter.read_text() if counter.exists() else "0"
            if int(after) <= int(before) or f"refresh={after}" not in refreshed:
                raise AssertionError(f"renderer did not refresh after input: {before} -> {after}\n{refreshed}")

            print("PASS: isolated footer PTY smoke (idle, typing, slash menu, refresh, resize)")
            print("State-transition coverage is reported separately by the focused Rust tests.")
            return 0
        finally:
            try:
                os.write(fd, b"\x03")
                os.kill(pid, signal.SIGTERM)
            except (OSError, ProcessLookupError):
                pass
            try:
                cleanup_deadline = time.monotonic() + 3
                while os.waitpid(pid, os.WNOHANG)[0] == 0:
                    if time.monotonic() >= cleanup_deadline:
                        os.kill(pid, signal.SIGKILL)
                        os.waitpid(pid, 0)
                        break
                    time.sleep(0.05)
            except ChildProcessError:
                pass
            os.close(fd)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except TimeoutError as exc:
        print(f"footer smoke timed out: {exc}", file=sys.stderr)
        raise SystemExit(1)
