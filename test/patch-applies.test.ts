import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadManifest } from "../src/patch/manifest";

/**
 * `CXSTATUSLINE_CODEX_CHECKOUT` accepts any local upstream checkout. For the normal cxstatusline
 * build checkout, `CXSTATUSLINE_TEST_UPSTREAM=1` stays opt-in while avoiding a personal path.
 */
const CODEX = process.env.CXSTATUSLINE_CODEX_CHECKOUT
  ?? (process.env.CXSTATUSLINE_TEST_UPSTREAM === "1"
    ? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "cxstatusline", "codex")
    : undefined);
const PATCHES = join(import.meta.dir, "..", "patches");
const available = CODEX !== undefined && CODEX !== "" && existsSync(join(CODEX, ".git"));

describe.skipIf(!available)("patch applies", () => {
  test("every manifest range applies cleanly at its lowest and highest tag", () => {
    const checkout = CODEX as string;
    const manifest = loadManifest(PATCHES);
    for (const range of manifest.patches) {
      for (const version of new Set([range.min, range.max])) {
        const tag = `${manifest.tag_prefix}${version}`;
        const wt = join(process.env.TMPDIR ?? "/tmp", `cx-apply-${process.pid}-${version}`);
        const add = spawnSync("git", ["-C", checkout, "worktree", "add", "--detach", wt, tag], { encoding: "utf8" });
        expect(add.status).toBe(0);
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const apply = spawnSync("git", ["-C", wt, "apply", "--index", join(PATCHES, range.file)], { encoding: "utf8" });
            expect(`${tag}: ${apply.stderr}`).toBe(`${tag}: `);
            expect(apply.status).toBe(0);
            expect(existsSync(join(wt, "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__footer__tests__cxstatusline_block_preserves_instruction_footer.snap"))).toBe(true);
            expect(spawnSync("git", ["-C", wt, "reset", "--hard", tag]).status).toBe(0);
          }
        } finally {
          spawnSync("git", ["-C", checkout, "worktree", "remove", "--force", wt]);
        }
      }
    }
  });
});
