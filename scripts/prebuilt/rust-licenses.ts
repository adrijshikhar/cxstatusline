/**
 * Rust dependency-license audit for the two redistributed binaries. `cargo deny check licenses`
 * (upstream's own policy file) is the gate; `cargo about generate` produces the notice text that is
 * appended to the archive's THIRD_PARTY_NOTICES.md. Both run against the patched upstream checkout.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./env";

export type Runner = (cmd: string, args: readonly string[], opts?: { cwd?: string }) =>
  { status: number | null; stdout: string; stderr: string };

export const RUST_NOTICES_MARKER = "## Rust dependency licenses (generated)";
const ABOUT_CONFIG = join(root, "scripts", "prebuilt", "about.toml");
const ABOUT_TEMPLATE = join(root, "scripts", "prebuilt", "about.hbs");

/** Fails the build when any dependency license falls outside upstream's own deny.toml allow list. */
export function auditRustLicenses(upstreamDir: string, run: Runner): void {
  const crate = join(upstreamDir, "codex-rs");
  const r = run("cargo", ["deny", "--manifest-path", join(crate, "Cargo.toml"), "check", "licenses"], { cwd: crate });
  if (r.status !== 0) {
    throw new Error(`cargo deny check licenses failed (exit ${r.status}): ${r.stderr.split("\n").slice(-20).join("\n")}`);
  }
}

/** Markdown produced by cargo-about for the workspace, restricted to the two shipped targets. */
export function generateRustNotices(upstreamDir: string, run: Runner): string {
  const crate = join(upstreamDir, "codex-rs");
  const r = run("cargo", [
    "about", "generate",
    "--config", ABOUT_CONFIG,
    "--manifest-path", join(crate, "Cargo.toml"),
    "--fail",
    ABOUT_TEMPLATE,
  ], { cwd: crate });
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(`cargo about generate failed (exit ${r.status}): ${r.stderr.split("\n").slice(-20).join("\n")}`);
  }
  return r.stdout;
}

/** Append the generated notices below the repository's own THIRD_PARTY_NOTICES.md in staging. */
export function appendRustNotices(stagingDir: string, generated: string): void {
  const file = join(stagingDir, "THIRD_PARTY_NOTICES.md");
  if (!existsSync(file)) throw new Error(`${file} is missing; assembleStaging must run first`);
  const current = readFileSync(file, "utf8");
  if (current.includes(RUST_NOTICES_MARKER)) throw new Error(`${file} already contains ${RUST_NOTICES_MARKER}`);
  const body = generated.endsWith("\n") ? generated : `${generated}\n`;
  writeFileSync(file, `${current.replace(/\n*$/, "\n")}\n${RUST_NOTICES_MARKER}\n\n${body}`);
}
