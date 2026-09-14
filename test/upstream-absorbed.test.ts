import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CCSTATUSLINE = process.env.CXSTATUSLINE_CCSTATUSLINE_CHECKOUT
  ?? resolve(import.meta.dir, "../../ccstatusline");
const available = existsSync(join(CCSTATUSLINE, ".git"));

describe.skipIf(!available)("upstream absorbed parity", () => {
  test("src/widgets/shared/progress-bar.ts is byte-identical to ccstatusline v2.2.29", () => {
    const localPath = resolve(import.meta.dir, "../src/widgets/shared/progress-bar.ts");
    const localContent = readFileSync(localPath, "utf8");

    const result = spawnSync("git", ["-C", CCSTATUSLINE, "show", "v2.2.29:src/widgets/shared/progress-bar.ts"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(localContent).toBe(result.stdout);
  });
});
