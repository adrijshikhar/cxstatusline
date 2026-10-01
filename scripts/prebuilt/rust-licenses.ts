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
/** Verbatim licences of the executables upstream's packager bundles next to Codex. */
export const TOOL_NOTICES_MARKER = "## Bundled tool licenses";
const NOTICES_DIR = join(root, "scripts", "prebuilt", "notices");
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
  if (!existsSync(file)) throw new Error(`${file} is missing; the legal files must be staged first`);
  const current = readFileSync(file, "utf8");
  if (current.includes(RUST_NOTICES_MARKER)) throw new Error(`${file} already contains ${RUST_NOTICES_MARKER}`);
  const body = generated.endsWith("\n") ? generated : `${generated}\n`;
  writeFileSync(file, `${current.replace(/\n*$/, "\n")}\n${RUST_NOTICES_MARKER}\n\n${body}`);
}

interface ToolNotice {
  readonly member: string;
  readonly heading: string;
  readonly texts: readonly string[];
}

/**
 * Append the licence texts of every bundled tool present in the package: ripgrep (MIT OR
 * Unlicense, texts kept in this repository), the patched zsh (zsh licence, kept here) and on Linux
 * bubblewrap (LGPL-2.1-or-later, read from the vendored source the binary was built from).
 */
export function appendToolNotices(packageDir: string, upstreamDir: string): void {
  const file = join(packageDir, "THIRD_PARTY_NOTICES.md");
  if (!existsSync(file)) throw new Error(`${file} is missing; the legal files must be staged first`);
  const current = readFileSync(file, "utf8");
  if (current.includes(TOOL_NOTICES_MARKER)) throw new Error(`${file} already contains ${TOOL_NOTICES_MARKER}`);
  const tools: ToolNotice[] = [
    { member: "codex-path/rg", heading: "### ripgrep (MIT OR Unlicense)", texts: [join(NOTICES_DIR, "ripgrep-LICENSE-MIT.txt"), join(NOTICES_DIR, "ripgrep-UNLICENSE.txt")] },
    { member: "codex-resources/zsh/bin/zsh", heading: "### zsh (zsh licence)", texts: [join(NOTICES_DIR, "zsh-LICENCE.txt")] },
    { member: "codex-resources/bwrap", heading: "### bubblewrap (LGPL-2.1-or-later)", texts: [join(upstreamDir, "codex-rs", "vendor", "bubblewrap", "COPYING")] },
  ];
  const sections: string[] = [];
  for (const tool of tools) {
    if (!existsSync(join(packageDir, tool.member))) continue;
    for (const text of tool.texts) {
      if (!existsSync(text)) throw new Error(`licence text ${text} for ${tool.member} is missing`);
    }
    const bodies = tool.texts.map((text) => readFileSync(text, "utf8").replace(/\n*$/, "\n"));
    sections.push(`${tool.heading}\n\n\`\`\`\n${bodies.join("\n")}\`\`\`\n`);
  }
  if (sections.length === 0) return;
  writeFileSync(file, `${current.replace(/\n*$/, "\n")}\n${TOOL_NOTICES_MARKER}\n\n${sections.join("\n")}`);
}
