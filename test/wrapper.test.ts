import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import type { Context } from "../src/context";
import type { FileDigest, PreparedPair } from "../src/distribution";
import { resolvePaths } from "../src/paths";
import {
  WRAPPER_MARKER,
  WRAPPER_MARKER_V2,
  activatePair,
  activeGeneration,
  ensureWrapper,
  generationWrapperScript,
  installPatchedBinary,
  installWrapper,
  isOurWrapper,
  readInstallation,
  wrapperScript,
} from "../src/patch/wrapper";
import { readState, writeState } from "../src/state";
import { tmpEnv } from "./helpers";

/** Give `paths.patchedBin` a body so `ensureWrapper(..., true)` is honest. */
function makePatchedBin(patchedBin: string): void {
  mkdirSync(join(patchedBin, ".."), { recursive: true });
  writeFileSync(patchedBin, "ELF");
  chmodSync(patchedBin, 0o755);
}

describe("wrapper", () => {
  test("script exports CXSTATUSLINE_COMMAND, execs the patched binary, intercepts update", () => {
    const s = wrapperScript("/lib/codex", "/bin/cx statusline");
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain(WRAPPER_MARKER);
    // sq(sq("/bin/cx statusline") + " render") - the inner quotes are what shlex::split sees.
    expect(s).toContain(`CXSTATUSLINE_COMMAND=''"'"'/bin/cx statusline'"'"' render'`);
    expect(s).toContain(`exec '/lib/codex' "$@"`);
    expect(s).toContain(`exec '/bin/cx statusline' update`);
  });
  test("the script actually runs: update is routed, everything else reaches the binary with the env var", () => {
    const { root } = tmpEnv();
    const fakeCodex = join(root, "codex");
    writeFileSync(fakeCodex, '#!/bin/sh\necho "codex:$*:$CXSTATUSLINE_COMMAND"\n');
    chmodSync(fakeCodex, 0o755);
    const fakeCx = join(root, "cx");
    writeFileSync(fakeCx, '#!/bin/sh\necho "cx:$*"\n');
    chmodSync(fakeCx, 0o755);
    const w = join(root, "wrapper");
    writeFileSync(w, wrapperScript(fakeCodex, fakeCx));
    chmodSync(w, 0o755);
    expect(spawnSync(w, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe(`codex:--version:'${fakeCx}' render`);
    expect(spawnSync(w, ["update"], { encoding: "utf8" }).stdout.trim()).toBe("cx:update");
  });
  test("isOurWrapper recognises the marker and nothing else", () => {
    const { root } = tmpEnv();
    const ours = join(root, "ours");
    writeFileSync(ours, wrapperScript("/a", "/b"));
    const theirs = join(root, "theirs");
    writeFileSync(theirs, "#!/bin/sh\nexec /real/codex\n");
    expect(isOurWrapper(ours)).toBe(true);
    expect(isOurWrapper(theirs)).toBe(false);
    expect(isOurWrapper(join(root, "missing"))).toBe(false);
    writeFileSync(theirs, `${"x".repeat(1024)}\n# cxstatusline-wrapper v1\n`);
    expect(isOurWrapper(theirs)).toBe(false); // a marker in a binary body is not our header
  });
  test("installWrapper replaces upstream's symlink with mode 755 and leaves no temp file", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    mkdirSync(p.binDir, { recursive: true });
    const real = join(root, "real");
    writeFileSync(real, "UPSTREAM-ELF");
    symlinkSync(real, p.wrapperPath);
    expect(installWrapper(p, "/cx")).toEqual({ kind: "replaced" });
    expect(isOurWrapper(p.wrapperPath)).toBe(true);
    expect(statSync(p.wrapperPath).mode & 0o777).toBe(0o755);
    expect(readdirSync(p.binDir)).toEqual(["codex"]);
    // The symlink target - upstream's own binary - is untouched.
    expect(readFileSync(real, "utf8")).toBe("UPSTREAM-ELF");
  });
  test("installWrapper REFUSES a foreign regular file and leaves its bytes alone", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    chmodSync(p.wrapperPath, 0o755);
    const r = installWrapper(p, "/cx");
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringContaining("refusing to replace it") });
    expect(readFileSync(p.wrapperPath, "utf8")).toContain("codex-real");
    expect(readdirSync(p.binDir)).toEqual(["codex"]);
  });
  test("ensureWrapper: present, then replaced after upstream re-creates its symlink", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    makePatchedBin(p.patchedBin);
    installWrapper(p, "/cx");
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "present" });
    // How the Standalone updater actually clobbers us: `curl ... install.sh | sh` re-creates
    // ~/.local/bin/codex as a symlink into ~/.codex/packages/standalone/current/bin/codex.
    const upstream = join(root, ".codex/packages/standalone/current/bin/codex");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(upstream, "UPSTREAM-ELF");
    rmSync(p.wrapperPath);
    symlinkSync(upstream, p.wrapperPath);
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "replaced" });
    expect(readFileSync(p.wrapperPath, "utf8")).toContain(WRAPPER_MARKER);
    expect(readFileSync(upstream, "utf8")).toBe("UPSTREAM-ELF");
  });

  test("ensureWrapper leaves a re-placed wrapper alone on the next call", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    makePatchedBin(p.patchedBin);
    installWrapper(p, "/cx");
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "present" });
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "present" });
  });
  test("ensureWrapper writes NOTHING when the patched binary is absent", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "UPSTREAM-ELF");
    mkdirSync(p.binDir, { recursive: true });
    symlinkSync(real, p.wrapperPath); // a working upstream launcher
    const r = ensureWrapper(p, "/cx", false);
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringContaining(p.patchedBin) });
    expect(readlinkSync(p.wrapperPath)).toBe(real); // still upstream's symlink, still working
    expect(isOurWrapper(p.wrapperPath)).toBe(false);
  });
  test("ensureWrapper refuses a foreign regular file rather than deleting it", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    makePatchedBin(p.patchedBin);
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    expect(ensureWrapper(p, "/cx", true)).toMatchObject({ kind: "refused" });
    expect(readFileSync(p.wrapperPath, "utf8")).toContain("codex-real");
  });
  test("installPatchedBinary copies then renames into libexec", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const built = join(root, "built-codex");
    const upstream = join(root, "upstream", "codex");
    writeFileSync(built, "ELF");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(upstream, "UPSTREAM-ELF");
    writeFileSync(join(upstream, "..", "codex-code-mode-host"), "HOST");
    installPatchedBinary(built, upstream, p);
    expect(readFileSync(p.patchedBin, "utf8")).toBe("ELF");
    expect(readFileSync(p.patchedCodeModeHost, "utf8")).toBe("HOST");
    expect(statSync(p.patchedBin).mode & 0o777).toBe(0o755);
    expect(statSync(p.patchedCodeModeHost).mode & 0o777).toBe(0o755);
    expect(readdirSync(p.libexecDir).sort()).toEqual(["codex", "codex-code-mode-host"]);
    expect(existsSync(`${p.patchedBin}.tmp-${process.pid}`)).toBe(false);
  });

  test("installPatchedBinary leaves the existing pair untouched when upstream lacks the host", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const built = join(root, "built-codex");
    const upstream = join(root, "upstream", "codex");
    mkdirSync(p.libexecDir, { recursive: true });
    writeFileSync(p.patchedBin, "OLD-CODEX");
    writeFileSync(p.patchedCodeModeHost, "OLD-HOST");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(built, "NEW-CODEX");
    writeFileSync(upstream, "UPSTREAM-CODEX");

    expect(() => installPatchedBinary(built, upstream, p)).toThrow(/codex-code-mode-host/);
    expect(readFileSync(p.patchedBin, "utf8")).toBe("OLD-CODEX");
    expect(readFileSync(p.patchedCodeModeHost, "utf8")).toBe("OLD-HOST");
  });

  test("installPatchedBinary restores the old pair when the second activation rename fails", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const built = join(root, "built-codex");
    const upstream = join(root, "upstream", "codex");
    mkdirSync(p.libexecDir, { recursive: true });
    writeFileSync(p.patchedBin, "OLD-CODEX");
    writeFileSync(p.patchedCodeModeHost, "OLD-HOST");
    writeFileSync(built, "NEW-CODEX");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(upstream, "UPSTREAM-CODEX");
    writeFileSync(join(upstream, "..", "codex-code-mode-host"), "NEW-HOST");
    const stagedCodex = `${p.patchedBin}.tmp-${process.pid}`;

    expect(() => installPatchedBinary(built, upstream, p, {
      rename(from, target) {
        if (from === stagedCodex && target === p.patchedBin) throw new Error("second activation rename failed");
        renameSync(from, target);
      },
    })).toThrow("second activation rename failed");

    expect(readFileSync(p.patchedBin, "utf8")).toBe("OLD-CODEX");
    expect(readFileSync(p.patchedCodeModeHost, "utf8")).toBe("OLD-HOST");
    expect(readdirSync(p.libexecDir).sort()).toEqual(["codex", "codex-code-mode-host"]);
  });
});

// ---------------------------------------------------------------------------
// Generations: one directory is the unit of activation, `current` is the switch.
// ---------------------------------------------------------------------------

const LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"] as const;

function digest(text: string): FileDigest {
  return { sha256: createHash("sha256").update(text).digest("hex"), size: Buffer.byteLength(text) };
}

/** A staging directory shaped exactly like the one task 2 hands to `activatePair`. */
function stagePair(root: string, opts: {
  codex?: string;
  host?: string;
  source?: "prebuilt" | "compiled";
  version?: string;
  installedAt?: string;
  legal?: boolean;
} = {}): PreparedPair {
  const dir = mkdtempSync(join(root, "staging "));
  const codex = opts.codex ?? "NEW-CODEX";
  const host = opts.host ?? "NEW-HOST";
  writeFileSync(join(dir, "codex"), codex);
  writeFileSync(join(dir, "codex-code-mode-host"), host);
  const source = opts.source ?? "prebuilt";
  if (opts.legal ?? source === "prebuilt") for (const f of LEGAL_FILES) writeFileSync(join(dir, f), `${f} body`);
  return {
    directory: dir,
    codexVersion: opts.version ?? "0.152.1",
    provenance: {
      source,
      cxVersion: "2.0.0",
      platform: "darwin-arm64",
      patchSha256: "a".repeat(64),
      upstreamCommit: "b".repeat(40),
      sourceCommit: null,
      sourceDirty: false,
      installedAt: opts.installedAt ?? "2026-09-07T12:13:14.000Z",
      executables: { codex: digest(codex), "codex-code-mode-host": digest(host) },
    },
  };
}

function ctxFor(env: ReturnType<typeof tmpEnv>["env"], cxBin = "/cx"): Context {
  return {
    env,
    paths: resolvePaths(env),
    run: () => ({ status: 0, stdout: "", stderr: "" }),
    which: () => null,
    freeBytes: () => 1e12,
    cxBin,
    patchesDir: "/p",
    now: () => new Date("2026-09-07T12:13:14.000Z"),
    log: () => {},
    say: () => {},
  };
}

/** A HOME whose path contains a space, plus a stock upstream launcher at the wrapper path. */
function spacedHome(): { env: ReturnType<typeof tmpEnv>["env"]; root: string; paths: ReturnType<typeof resolvePaths>; stock: string } {
  const { env, root } = tmpEnv("cxstatusline test ");
  const paths = resolvePaths(env);
  const stock = join(root, "stock codex");
  writeFileSync(stock, "#!/bin/sh\necho stock\n");
  chmodSync(stock, 0o755);
  mkdirSync(paths.binDir, { recursive: true });
  symlinkSync(stock, paths.wrapperPath);
  return { env, root, paths, stock };
}

/**
 * The safety invariant. A fresh `codex` invocation must observe exactly one of:
 * the stock launcher, or our wrapper resolving through `current` to a COMPLETE generation.
 * A half-copied pair, or `current` pointing at a directory missing either executable, is the
 * failure this whole layout exists to prevent.
 */
function assertNeverMixed(paths: ReturnType<typeof resolvePaths>): "stock" | "generation" {
  const active = activeGeneration(paths);
  if (active !== null) {
    for (const f of ["codex", "codex-code-mode-host", "installation.json"]) {
      expect(existsSync(join(active, f))).toBe(true);
    }
  }
  const wrapperIsOurs = existsSync(paths.wrapperPath) && isOurWrapper(paths.wrapperPath);
  if (wrapperIsOurs) {
    expect(active).not.toBeNull();
    return "generation";
  }
  return "stock";
}

describe("generation activation", () => {
  test("wrapper v2 resolves the executable through `current` exactly once", () => {
    const s = generationWrapperScript("/h/.local/libexec/cx statusline/current", "/bin/cx statusline");
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain(WRAPPER_MARKER_V2);
    expect(s).toContain(`generation=$(CDPATH= cd -P -- '/h/.local/libexec/cx statusline/current' && pwd -P) || exit 1`);
    expect(s).toContain(`exec "$generation/codex" "$@"`);
    expect(s).toContain(`CXSTATUSLINE_COMMAND=''"'"'/bin/cx statusline'"'"' render'`);
    expect(s).toContain(`exec '/bin/cx statusline' update`);
  });

  test("isOurWrapper still recognises a v1 wrapper an owner already has installed", () => {
    const { root } = tmpEnv();
    const v1 = join(root, "v1");
    writeFileSync(v1, wrapperScript("/lib/codex", "/cx"));
    const v2 = join(root, "v2");
    writeFileSync(v2, generationWrapperScript("/lib/current", "/cx"));
    expect(isOurWrapper(v1)).toBe(true);
    expect(isOurWrapper(v2)).toBe(true);
  });

  test("publishes a complete generation, then points current at it (HOME contains a space)", () => {
    const { env, root, paths } = spacedHome();
    const pair = stagePair(root);

    activatePair(pair, ctxFor(env));

    const active = activeGeneration(paths);
    expect(active).not.toBeNull();
    expect(active?.startsWith(`${paths.generationsDir}/`)).toBe(true);
    expect(readdirSync(active as string).sort()).toEqual([...LEGAL_FILES, "codex", "codex-code-mode-host", "installation.json"].sort());
    expect(readFileSync(join(active as string, "codex"), "utf8")).toBe("NEW-CODEX");
    expect(readFileSync(join(active as string, "codex-code-mode-host"), "utf8")).toBe("NEW-HOST");
    expect(statSync(join(active as string, "codex")).mode & 0o777).toBe(0o755);
    expect(statSync(join(active as string, "codex-code-mode-host")).mode & 0o777).toBe(0o755);
    expect(lstatSync(paths.currentGeneration).isSymbolicLink()).toBe(true);
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
    expect(readFileSync(paths.wrapperPath, "utf8")).toBe(generationWrapperScript(paths.currentGeneration, "/cx"));
    // The caller still owns the staging directory.
    expect(existsSync(pair.directory)).toBe(true);
    expect(assertNeverMixed(paths)).toBe("generation");
  });

  test("installation.json is the PreparedPair without its temporary directory", () => {
    const { env, root, paths } = spacedHome();
    const pair = stagePair(root, { source: "compiled", legal: false });

    activatePair(pair, ctxFor(env));

    const record = readInstallation(paths);
    const { directory, ...expected } = pair;
    expect(record).toEqual(expected);
    expect(record).not.toHaveProperty("directory");
    expect(directory).toBe(pair.directory);
    // Compiled pairs carry no legal texts.
    expect(readdirSync(activeGeneration(paths) as string).sort()).toEqual(["codex", "codex-code-mode-host", "installation.json"]);
  });

  test("generation metadata stays authoritative when state.json disagrees", () => {
    const { env, root, paths } = spacedHome();
    activatePair(stagePair(root, { version: "0.152.1" }), ctxFor(env));
    writeState(paths.stateFile, { ...readState(paths.stateFile).state, patched_from: "0.9.9" });

    expect(readInstallation(paths)?.codexVersion).toBe("0.152.1");
    expect(readState(paths.stateFile).state.patched_from).toBe("0.9.9");
  });

  test("generation names are unique and old generations survive a second activation", () => {
    const { env, root, paths } = spacedHome();
    activatePair(stagePair(root, { codex: "OLD-CODEX", installedAt: "2026-09-07T12:13:14.000Z" }), ctxFor(env));
    const first = activeGeneration(paths) as string;

    activatePair(stagePair(root, { codex: "NEW-CODEX", installedAt: "2026-09-07T12:13:14.000Z" }), ctxFor(env));
    const second = activeGeneration(paths) as string;

    expect(second).not.toBe(first);
    expect(readdirSync(paths.generationsDir).sort()).toEqual([basename(first), basename(second)].sort());
    expect(readFileSync(join(first, "codex"), "utf8")).toBe("OLD-CODEX"); // retained for live sessions
    expect(readFileSync(join(second, "codex"), "utf8")).toBe("NEW-CODEX");
  });

  test("the installed wrapper really execs the active generation's codex", () => {
    const { env, root, paths } = spacedHome();
    const pair = stagePair(root, { codex: '#!/bin/sh\necho "gen:$*:$CXSTATUSLINE_COMMAND"\n' });

    activatePair(pair, ctxFor(env, join(root, "cx bin")));

    writeFileSync(join(root, "cx bin"), '#!/bin/sh\necho "cx:$*"\n');
    chmodSync(join(root, "cx bin"), 0o755);
    const r = spawnSync(paths.wrapperPath, ["--version"], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe(`gen:--version:'${join(root, "cx bin")}' render`);
    expect(spawnSync(paths.wrapperPath, ["update"], { encoding: "utf8" }).stdout.trim()).toBe("cx:update");
  });

  test("REFUSES a foreign regular launcher before creating any generation", () => {
    const { env, root } = tmpEnv("cxstatusline test ");
    const paths = resolvePaths(env);
    mkdirSync(paths.binDir, { recursive: true });
    writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    chmodSync(paths.wrapperPath, 0o755);

    expect(() => activatePair(stagePair(root), ctxFor(env))).toThrow(/refusing to replace it/);

    expect(readFileSync(paths.wrapperPath, "utf8")).toContain("codex-real");
    expect(existsSync(paths.generationsDir)).toBe(false);
    expect(existsSync(paths.currentGeneration)).toBe(false);
  });

  test("records the stock launcher restore target before replacing the launcher", () => {
    const { env, root, paths, stock } = spacedHome();
    expect(readState(paths.stateFile).state.launcher_restore).toBeNull();

    activatePair(stagePair(root), ctxFor(env));

    expect(readState(paths.stateFile).state.launcher_restore).toEqual({ kind: "symlink", target: stock });
  });

  test("a staged pair whose bytes do not match its digests is never published", () => {
    const { env, root, paths } = spacedHome();
    const pair = stagePair(root);
    writeFileSync(join(pair.directory, "codex"), "TAMPERED");

    expect(() => activatePair(pair, ctxFor(env))).toThrow(/codex/);

    expect(existsSync(paths.currentGeneration)).toBe(false);
    expect(assertNeverMixed(paths)).toBe("stock");
  });

  test("a prebuilt pair missing its legal texts is never published", () => {
    const { env, root, paths } = spacedHome();
    const pair = stagePair(root, { legal: false });

    expect(() => activatePair(pair, ctxFor(env))).toThrow(/NOTICE|LICENSE|THIRD_PARTY/);

    expect(existsSync(paths.currentGeneration)).toBe(false);
    expect(assertNeverMixed(paths)).toBe("stock");
  });
});

describe("generation activation failure injection", () => {
  test("staging: an unwritable generations directory leaves the previous generation active", () => {
    const { env, root, paths } = spacedHome();
    activatePair(stagePair(root, { codex: "OLD-CODEX" }), ctxFor(env));
    const before = activeGeneration(paths) as string;
    const wrapperBefore = readFileSync(paths.wrapperPath, "utf8");
    chmodSync(paths.generationsDir, 0o555);
    try {
      expect(() => activatePair(stagePair(root, { codex: "NEW-CODEX" }), ctxFor(env))).toThrow();
    } finally {
      chmodSync(paths.generationsDir, 0o755);
    }

    expect(activeGeneration(paths)).toBe(before);
    expect(readFileSync(join(before, "codex"), "utf8")).toBe("OLD-CODEX");
    expect(readdirSync(paths.generationsDir)).toEqual([basename(before)]);
    expect(readFileSync(paths.wrapperPath, "utf8")).toBe(wrapperBefore);
    expect(assertNeverMixed(paths)).toBe("generation");
  });

  test("metadata: a failed installation.json commit publishes nothing", () => {
    const { env, root, paths } = spacedHome();

    expect(() => activatePair(stagePair(root), ctxFor(env), {
      rename(from, to) {
        if (String(to).endsWith("installation.json")) throw new Error("metadata commit failed");
        renameSync(from, to);
      },
    })).toThrow("metadata commit failed");

    expect(existsSync(paths.currentGeneration)).toBe(false);
    expect(readdirSync(paths.generationsDir)).toEqual([]); // no half-built generation left behind
    expect(assertNeverMixed(paths)).toBe("stock");
  });

  test("wrapper preparation: an unwritable bin directory leaves the stock launcher in place", () => {
    const { env, root, paths, stock } = spacedHome();
    chmodSync(paths.binDir, 0o555);
    try {
      expect(() => activatePair(stagePair(root), ctxFor(env))).toThrow();
    } finally {
      chmodSync(paths.binDir, 0o755);
    }

    expect(readlinkSync(paths.wrapperPath)).toBe(stock); // still stock, still launchable
    expect(existsSync(paths.currentGeneration)).toBe(false);
    expect(assertNeverMixed(paths)).toBe("stock");
  });

  test("pointer: a failed symlink stage keeps the old pointer and the old wrapper", () => {
    const { env, root, paths } = spacedHome();
    activatePair(stagePair(root, { codex: "OLD-CODEX" }), ctxFor(env));
    const before = activeGeneration(paths) as string;
    chmodSync(paths.libexecDir, 0o555); // generations/ already exists, so only the pointer fails
    try {
      expect(() => activatePair(stagePair(root, { codex: "NEW-CODEX" }), ctxFor(env))).toThrow();
    } finally {
      chmodSync(paths.libexecDir, 0o755);
    }

    expect(activeGeneration(paths)).toBe(before);
    expect(readFileSync(join(before, "codex"), "utf8")).toBe("OLD-CODEX");
    expect(assertNeverMixed(paths)).toBe("generation");
  });

  test("after the pointer moved: a failed wrapper commit restores the previous generation", () => {
    const { env, root, paths } = spacedHome();
    activatePair(stagePair(root, { codex: "OLD-CODEX" }), ctxFor(env));
    const before = activeGeneration(paths) as string;
    const wrapperBefore = readFileSync(paths.wrapperPath, "utf8");

    expect(() => activatePair(stagePair(root, { codex: "NEW-CODEX" }), ctxFor(env), {
      rename(from, to) {
        if (to === paths.wrapperPath) throw new Error("wrapper commit failed");
        renameSync(from, to);
      },
    })).toThrow("wrapper commit failed");

    expect(activeGeneration(paths)).toBe(before); // pointer put back
    expect(readFileSync(join(before, "codex"), "utf8")).toBe("OLD-CODEX");
    expect(readFileSync(paths.wrapperPath, "utf8")).toBe(wrapperBefore);
    expect(readdirSync(paths.binDir)).toEqual(["codex"]); // no staged wrapper left behind
    expect(assertNeverMixed(paths)).toBe("generation");
  });

  test("first install: a failed wrapper commit after the pointer moved leaves stock launchable", () => {
    const { env, root, paths, stock } = spacedHome();

    expect(() => activatePair(stagePair(root), ctxFor(env), {
      rename(from, to) {
        if (to === paths.wrapperPath) throw new Error("wrapper commit failed");
        renameSync(from, to);
      },
    })).toThrow("wrapper commit failed");

    expect(existsSync(paths.currentGeneration)).toBe(false); // pointer withdrawn, generation kept
    expect(readdirSync(paths.generationsDir)).toHaveLength(1);
    expect(readlinkSync(paths.wrapperPath)).toBe(stock);
    expect(assertNeverMixed(paths)).toBe("stock");
  });

  test("state: an unwritable state directory aborts before anything is replaced", () => {
    const { env, root, paths, stock } = spacedHome();
    mkdirSync(paths.stateDir, { recursive: true });
    chmodSync(paths.stateDir, 0o555);
    try {
      expect(() => activatePair(stagePair(root), ctxFor(env))).toThrow();
    } finally {
      chmodSync(paths.stateDir, 0o755);
    }

    expect(existsSync(paths.generationsDir)).toBe(false);
    expect(existsSync(paths.currentGeneration)).toBe(false);
    expect(readlinkSync(paths.wrapperPath)).toBe(stock);
  });

  test("a `current` pointing outside the managed generations tree is not treated as active", () => {
    const { env, root, paths } = spacedHome();
    mkdirSync(paths.libexecDir, { recursive: true });
    const foreign = join(root, "foreign gen");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "codex"), "FOREIGN");
    symlinkSync(foreign, paths.currentGeneration);

    expect(activeGeneration(paths)).toBeNull();
    expect(readInstallation(paths)).toBeNull();

    activatePair(stagePair(root), ctxFor(env));
    expect(activeGeneration(paths)?.startsWith(`${paths.generationsDir}/`)).toBe(true);
    expect(readFileSync(join(foreign, "codex"), "utf8")).toBe("FOREIGN"); // untouched
  });

  test("SIGKILL during activation never leaves a mixed observation", async () => {
    const child = fileURLToPath(new URL("./fixtures/activate-child.ts", import.meta.url));
    let interrupted = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { env, root, paths } = spacedHome();
      // Big enough that copying and hashing the pair spans the kill window.
      const pair = stagePair(root, { codex: "C".repeat(8 << 20), host: "H".repeat(8 << 20) });
      const args = join(root, "args.json");
      const started = join(root, "started");
      const done = join(root, "done");
      writeFileSync(args, JSON.stringify({ pair, env, started, done }));

      const proc = spawn(process.execPath, ["run", child, args], { stdio: "ignore" });
      const exited = once(proc, "exit");
      const deadline = Date.now() + 30_000;
      while (!existsSync(started) && Date.now() < deadline); // spin: kill as close to the start as possible
      proc.kill("SIGKILL");
      expect((await exited)[1]).toBe("SIGKILL");

      if (!existsSync(done)) interrupted++;
      assertNeverMixed(paths); // the whole point: stock, or a complete generation. Never in between.
    }
    expect(interrupted).toBeGreaterThan(0);
  }, 120_000);
});
