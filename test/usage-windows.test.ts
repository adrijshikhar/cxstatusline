import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("Local reset dates honor the process timezone, including a date boundary", () => {
  const module = new URL("../src/utils/usage-windows.ts", import.meta.url).href;
  const r = spawnSync(process.execPath, ["-e", `
    import { formatUsageResetAt as format } from ${JSON.stringify(module)};
    console.log(JSON.stringify([
      format('2026-09-05T08:30:00Z', false, 'local'),
      format('2026-09-05T08:30:00Z', false, 'Asia/Kolkata'),
      format('2026-09-05T08:30:00Z', false, 'UTC'),
      format('2026-09-05T08:30:00Z'),
      format('2026-09-05T20:00:00Z', false, 'local'),
      format('2026-09-05T20:00:00Z', false, 'invalid-zone'),
    ]));
  `], { env: { ...process.env, TZ: "Asia/Kolkata" }, encoding: "utf8" });
  expect(r.status).toBe(0);
  const values: string[] = JSON.parse(r.stdout);
  expect(values[0]).toContain("2026-09-05 14:00");
  expect(values[1]).toContain("2026-09-05 14:00");
  expect(values[2]).toContain("2026-09-05 8:30 UTC");
  expect(values[3]).toBe(values[2]);
  expect(values[4]).toContain("2026-09-06 1:30");
  expect(values[5]).toBe("2026-09-05 20:00 UTC");
});
