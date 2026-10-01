import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "../src/paths";
import {
  GENERATION_NAME,
  createGeneration,
  executablePath,
  isGenerationDir,
  isPackageLayout,
  packageFiles,
  verifyPackage,
} from "../src/patch/generation";
import { stagePackage, tmpEnv } from "./helpers";

const TARGET = "aarch64-apple-darwin";

describe("packageFiles", () => {
  test("lists every regular file by relative path, skipping installation.json and the root alias", () => {
    const { root } = tmpEnv();
    const pair = stagePackage(root);
    symlinkSync("bin/codex", join(pair.directory, "codex"));
    writeFileSync(join(pair.directory, "installation.json"), "{}");
    expect(Object.keys(packageFiles(pair.directory)).sort()).toEqual([
      "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "bin/codex", "bin/codex-code-mode-host",
      "codex-package.json", "codex-path/rg", "codex-resources/zsh/bin/zsh",
    ]);
  });

  test("rejects any other symlink: upstream's daemon refuses to copy a package containing one", () => {
    const { root } = tmpEnv();
    const pair = stagePackage(root);
    symlinkSync("/usr/bin/true", join(pair.directory, "codex-path", "fd"));
    expect(() => packageFiles(pair.directory)).toThrow(/codex-path\/fd is a symbolic link/);
  });
});

describe("verifyPackage", () => {
  const good = () => {
    const { root } = tmpEnv();
    const pair = stagePackage(root, { version: "0.157.0" });
    return { dir: pair.directory, files: pair.provenance.files };
  };
  const expect157 = { target: TARGET, codexVersion: "0.157.0" };

  test("accepts the package its file map describes", () => {
    const { dir, files } = good();
    expect(verifyPackage(dir, files, expect157)).toBeNull();
  });

  test("names the first problem: missing member, wrong digest, wrong mode bit", () => {
    const { dir, files } = good();
    expect(verifyPackage(dir, { ...files, "codex-resources/bwrap": { sha256: "0".repeat(64), size: 1 } }, expect157)).toBe("codex-resources/bwrap is missing");
    writeFileSync(join(dir, "codex-path", "rg"), "changed");
    expect(verifyPackage(dir, files, expect157)).toBe("codex-path/rg does not match its recorded digest");
    chmodSync(join(dir, "codex-path", "rg"), 0o644);
    expect(verifyPackage(dir, files, expect157)).toBe("codex-path/rg has the wrong executable bit");
  });

  test("checks what upstream's daemon checks in codex-package.json: entrypoint, target, version", () => {
    const { dir, files } = good();
    expect(verifyPackage(dir, files, { target: "x86_64-apple-darwin", codexVersion: "0.157.0" })).toBe("codex-package.json target is aarch64-apple-darwin, expected x86_64-apple-darwin");
    expect(verifyPackage(dir, files, { target: TARGET, codexVersion: "0.158.0" })).toBe("codex-package.json version is 0.157.0, expected 0.158.0");
    const meta = { layoutVersion: 1, version: "0.157.0", target: TARGET, variant: "codex", entrypoint: "codex", resourcesDir: "codex-resources", pathDir: "codex-path" };
    writeFileSync(join(dir, "codex-package.json"), JSON.stringify(meta));
    const patched = { ...files, "codex-package.json": packageFiles(dir)["codex-package.json"]! };
    expect(verifyPackage(dir, patched, expect157)).toBe('codex-package.json entrypoint is "codex", not "bin/codex"');
  });
});

describe("createGeneration", () => {
  test("moves the staged package into the generations tree, adds the alias and the record", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const pair = stagePackage(root);
    const staging = pair.directory;

    const dir = createGeneration(pair, paths);

    expect(existsSync(staging)).toBe(false);
    expect(GENERATION_NAME.test(dir.split("/").pop()!)).toBe(true);
    expect(lstatSync(dir).mode & 0o777).toBe(0o755);
    expect(readlinkSync(join(dir, "codex"))).toBe("bin/codex");
    expect(isPackageLayout(dir)).toBe(true);
    expect(isGenerationDir(dir)).toBe(true);
    expect(executablePath(dir, "codex")).toBe(join(dir, "bin", "codex"));
    expect(packageFiles(dir)).toEqual(pair.provenance.files);
    // Exactly one symlink in the whole tree: the root alias.
    expect(readdirSync(dir).filter((n) => lstatSync(join(dir, n)).isSymbolicLink())).toEqual(["codex"]);
  });

  test("a failed move leaves the staging directory intact and the generations tree empty", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const pair = stagePackage(root);
    expect(() => createGeneration(pair, paths, () => { throw new Error("rename failed"); })).toThrow("rename failed");
    expect(existsSync(pair.directory)).toBe(true);
    expect(readdirSync(paths.generationsDir)).toEqual([]);
  });

  test("a failure after the move removes the half-made generation", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const pair = stagePackage(root);
    const rename: typeof renameSync = (from, to) => {
      if (String(to).endsWith("installation.json")) throw new Error("metadata commit failed");
      renameSync(from, to);
    };
    expect(() => createGeneration(pair, paths, rename)).toThrow("metadata commit failed");
    expect(readdirSync(paths.generationsDir)).toEqual([]);
  });

  test("refuses a staging directory that is not the package its provenance describes", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const pair = stagePackage(root, { version: "0.157.0" });
    const wrongTarget = { ...pair, provenance: { ...pair.provenance, target: "x86_64-apple-darwin" } };
    expect(() => createGeneration(wrongTarget, paths)).toThrow(/target is aarch64-apple-darwin, expected x86_64-apple-darwin/);
    expect(existsSync(pair.directory)).toBe(true);
  });
});

describe("legacy flat generations", () => {
  test("a flat directory from an older cxstatusline is a package neither for isGenerationDir nor isPackageLayout", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    const flat = join(paths.generationsDir, "0.157.0-20260928T091105-a63712");
    mkdirSync(flat, { recursive: true });
    for (const f of ["codex", "codex-code-mode-host", "installation.json"]) writeFileSync(join(flat, f), "x");
    expect(isPackageLayout(flat)).toBe(false);
    expect(isGenerationDir(flat)).toBe(false);
    expect(executablePath(flat, "codex")).toBe(join(flat, "codex"));
  });
});
