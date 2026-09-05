import { expect, test } from "bun:test";
import { assertPackageFiles } from "../scripts/check-package";

test("packed artifact refuses missing notices and accidental private files", () => {
  const files = ["package.json", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
    "dist/cxstatusline.js", "dist/THIRD_PARTY_LICENSES.txt", "patches/manifest.json",
    "patches/ink@6.2.0.patch", "patches/codex-0.152.1.patch", "patches/codex-0.153.0.patch"];
  expect(() => assertPackageFiles(files)).not.toThrow();
  expect(() => assertPackageFiles(files.filter(file => file !== "NOTICE"))).toThrow();
  expect(() => assertPackageFiles([...files, ".env"])).toThrow();
});
