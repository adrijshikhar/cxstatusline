import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: [["line"]],
  webServer: { command: "bun run dev -- --host 127.0.0.1 --port 4173", url: "http://127.0.0.1:4173/", reuseExistingServer: false, timeout: 30_000 },
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
});
