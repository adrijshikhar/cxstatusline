import { accessSync, constants, existsSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Runner } from "../env";

export const MIN_FREE_BYTES = 20 * 1024 ** 3;

/**
 * Headroom the default (prebuilt) install needs: one downloaded archive plus one extracted staging
 * copy plus the generation it is copied into, all under `libexecDir`. Nothing like a source build,
 * so the 20 GiB compile figure would refuse machines that can install perfectly well.
 */
export const MIN_STAGING_FREE_BYTES = 2 * 1024 ** 3;

/** From `codex-rs/rust-toolchain.toml` at the supported tags. */
export const REQUIRED_TOOLCHAIN = "1.95.0";
export const REQUIRED_COMPONENTS = ["clippy", "rustfmt", "rust-src"] as const;

export interface PreflightDeps {
  which(cmd: string): string | null;
  run: Runner;
  freeBytes(path: string): number;
}

export type PreflightResult = { ok: true } | { ok: false; reason: string; fix: string };

const gib = (b: number): string => `${(b / 1024 ** 3).toFixed(1)} GiB`;
const no = (reason: string, fix: string): PreflightResult => ({ ok: false, reason, fix });

/**
 * Spec L166-168 requires the toolchain check *here*, not eight minutes into a detached build.
 * `rustup` would auto-install the channel on first `cargo build`, but that turns a 5-second
 * failure into a long one the user never sees, because the build is detached.
 */
function checkToolchain(deps: PreflightDeps): PreflightResult {
  const list = deps.run("rustup", ["toolchain", "list"]);
  if (list.status !== 0) {
    return no(`"rustup toolchain list" failed (exit ${String(list.status)}): ${list.stderr.trim()}`,
      "check your rustup installation, then re-run");
  }
  if (!list.stdout.includes(REQUIRED_TOOLCHAIN)) {
    return no(`Rust ${REQUIRED_TOOLCHAIN} (rust-toolchain.toml) is not installed`,
      `rustup toolchain install ${REQUIRED_TOOLCHAIN} --component ${REQUIRED_COMPONENTS.join(" --component ")}`);
  }
  const comps = deps.run("rustup", ["component", "list", "--installed", "--toolchain", REQUIRED_TOOLCHAIN]);
  if (comps.status !== 0) return { ok: true }; // older rustup: presence of the channel is enough
  const missing = REQUIRED_COMPONENTS.filter((c) => !comps.stdout.includes(c));
  if (missing.length > 0) {
    return no(`Rust ${REQUIRED_TOOLCHAIN} is missing ${missing.join(", ")}`,
      `rustup component add ${missing.join(" ")} --toolchain ${REQUIRED_TOOLCHAIN}`);
  }
  return { ok: true };
}

export function preflight(deps: PreflightDeps, shareDir: string): PreflightResult {
  if (!deps.which("git")) {
    return no("git is not on PATH", "install git (xcode-select --install, or your package manager)");
  }
  if (!deps.which("rustup")) {
    return no(
      `rustup is not on PATH; the Codex toolchain (rust-toolchain.toml -> ${REQUIRED_TOOLCHAIN}) is installed through it`,
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   then reopen your shell",
    );
  }
  if (!deps.which("cargo")) {
    return no("cargo is not on PATH", "rustup default stable   (or ensure ~/.cargo/bin is on PATH)");
  }
  const toolchain = checkToolchain(deps);
  if (!toolchain.ok) return toolchain;
  const free = deps.freeBytes(shareDir);
  if (free < MIN_FREE_BYTES) {
    return no(`${gib(free)} free at ${shareDir}; a Codex release build needs 20 GiB`,
      "free disk space or point XDG_DATA_HOME elsewhere");
  }
  return { ok: true };
}

/**
 * The default install path's preflight: no Rust, no source tree, no 20 GiB.
 * What it does check is what a download-and-activate can still fail on late and expensively -
 * a destination we cannot write, and not enough room to stage the pair before swapping it in.
 */
export function prebuiltPreflight(
  deps: { freeBytes(path: string): number },
  paths: { readonly libexecDir: string; readonly binDir: string },
): PreflightResult {
  for (const dir of [paths.libexecDir, paths.binDir]) {
    // The nearest existing ancestor, so asking the question never creates the directory itself.
    const probe = nearestExisting(dir);
    try {
      accessSync(probe, constants.W_OK);
    } catch {
      return no(`${probe} is not writable, so ${dir} cannot be installed into`,
        `fix the permissions on ${probe}, then re-run`);
    }
  }
  const free = deps.freeBytes(paths.libexecDir);
  if (free < MIN_STAGING_FREE_BYTES) {
    return no(`${gib(free)} free at ${paths.libexecDir}; staging a prebuilt Codex pair needs 2 GiB`,
      "free disk space, then re-run");
  }
  return { ok: true };
}

function whichReal(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const p = join(dir, cmd);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Nearest existing ancestor, so a read-only diagnostic never has to create directories. */
function nearestExisting(path: string): string {
  let p = path;
  while (!existsSync(p)) {
    const parent = dirname(p);
    if (parent === p) return p;
    p = parent;
  }
  return p;
}

export function realDeps(): PreflightDeps {
  return {
    which: whichReal,
    run: (cmd, args, opts) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", cwd: opts?.cwd });
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    // Why not mkdirSync here: `doctor` calls preflight, and a read-only report must not create
    // ~/.local/share/cxstatusline as a side effect of asking how much disk is free.
    freeBytes: (path) => {
      const s = statfsSync(nearestExisting(path));
      return Number(s.bavail) * Number(s.bsize);
    },
  };
}
