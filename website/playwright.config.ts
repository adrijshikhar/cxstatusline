import { defineConfig } from "@playwright/test";

const mode = process.env.PLAYWRIGHT_MODE === "dev" ? "dev" : "production";

const serverEnv: Record<string, string> = {
  VITE_ENABLE_AGENTATION: "0",
  ASTRO_DEV_BACKGROUND: "0",
  ASTRO_PREVIEW_BACKGROUND: "0",
};

const webServer = mode === "dev"
  ? {
      command: "bun run dev -- --host 127.0.0.1 --port 4173 --ignore-lock",
      url: "http://127.0.0.1:4173/",
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnv,
    }
  : {
      command: "bun run build && bunx astro preview --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/",
      reuseExistingServer: false,
      timeout: 60_000,
      env: serverEnv,
    };

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: [["line"]],
  webServer,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
});
