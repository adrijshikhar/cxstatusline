import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../src/env";
import { buildPatched } from "../src/patch/build";
import { tmpEnv } from "./helpers";

const snapshot = "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__footer__tests__cxstatusline_block_preserves_instruction_footer.snap";
const content = ['---', 'source: tui/src/bottom_pane/footer.rs', 'expression: terminal.backend()', '---',
  ...['status-0', 'status-1', 'status-2', 'esc esc to edit previous message'].map(s => `"  ${s.padEnd(78)}"`), ''].join('\n');

for (const prior of ["none", "shipped", "conflict", "symlink"] as const) {
  test(`real Git rebuild preserves artifacts and handles ${prior} snapshot`, () => {
    const { root } = tmpEnv();
    try {
      const sourceDir = join(root, "source");
      mkdirSync(sourceDir);
      const git = (...args: string[]) => {
        const r = spawnSync("git", ["-C", sourceDir, ...args], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout;
      };
      git("init");
      git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "base");
      git("tag", "rust-v0.153.0");
      const file = join(sourceDir, snapshot);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, content);
      git("add", "--", snapshot);
      const patchFile = join(root, "test.patch");
      writeFileSync(patchFile, git("diff", "--cached", "--binary"));
      git("reset", "--hard");
      if (prior !== "none") {
        mkdirSync(join(file, ".."), { recursive: true });
        if (prior === "symlink") {
          writeFileSync(join(root, "external"), content);
          symlinkSync(join(root, "external"), file);
        } else writeFileSync(file, prior === "shipped" ? content : "owner data");
      }
      const bin = join(sourceDir, "codex-rs/target/release/codex");
      const host = join(sourceDir, "codex-rs/target/release/codex-code-mode-host");
      mkdirSync(join(bin, ".."), { recursive: true });
      writeFileSync(join(bin, "..", "keep"), "cached");
      writeFileSync(join(sourceDir, "keep"), "untracked");
      let builds = 0;
      let testRuns = 0;
      const run: Runner = (cmd, args, opts) => {
        if (cmd === "cargo" && args[0] === "test") {
          testRuns++;
          return { status: 0, stdout: "", stderr: "" };
        }
        if (cmd === "cargo") {
          builds++;
          writeFileSync(bin, "ELF");
          writeFileSync(host, "HOST-ELF");
          return { status: 0, stdout: "", stderr: "" };
        }
        if (args[2] === "fetch") return { status: 0, stdout: "", stderr: "" };
        const r = spawnSync(cmd, [...args], { cwd: opts?.cwd, encoding: "utf8" });
        return { status: r.status, stdout: r.stdout, stderr: r.stderr };
      };
      const build = () => buildPatched({ sourceDir, patchFile, tag: "rust-v0.153.0" }, run, () => {}, () => null);
      if (prior === "conflict" || prior === "symlink") {
        expect(build).toThrow(/snapshot|already exists/);
        expect(builds).toBe(0);
        expect(readFileSync(file, "utf8")).toBe(prior === "conflict" ? "owner data" : content);
      } else {
        expect(build()).toMatchObject({ codex: bin, codexCodeModeHost: host, upstreamCommit: expect.stringMatching(/^[0-9a-f]{40}$/) });
        expect(build()).toMatchObject({ codex: bin, codexCodeModeHost: host });
        expect(builds).toBe(2);
        expect(testRuns).toBe(2); // the focused suite runs before every pair is handed back
        expect(readFileSync(file, "utf8")).toBe(content);
      }
      expect(readFileSync(join(sourceDir, "keep"), "utf8")).toBe("untracked");
      expect(readFileSync(join(bin, "..", "keep"), "utf8")).toBe("cached");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
