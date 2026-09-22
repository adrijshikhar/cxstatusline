import { expect, test, type Page } from "@playwright/test";
import defaultLayout from "../src/sample-settings.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };

const storageKey = "cxstatusline.playground.settings.v1";

async function waitForEditor(page: Page): Promise<void> {
  await expect(page.locator("#playground-skeleton")).toBeHidden();
  if (await page.locator("#edit").isVisible()) await page.locator("#edit").click();
  await expect(page.locator("#terminal .xterm"), "desktop mount").toHaveCount(1);
  await expect(page.locator("#terminal")).toContainText("Main Menu", { timeout: 15_000 });
  await expect(page.locator("#terminal")).not.toHaveAttribute("inert", "");
}

async function terminalKeys(page: Page, keys: readonly string[]): Promise<void> {
  await page.locator("#terminal .xterm-helper-textarea").focus();
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(50);
  }
}

test("mobile stays static and does not touch the playground runtime", async ({ page }) => {
  const requests: string[] = [];
  let storageReads = 0;
  let storageWrites = 0;
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript((key) => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Object.defineProperty(window, "__storageAudit", { value: { reads: 0, writes: 0 }, writable: false });
    Storage.prototype.getItem = function (name) { if (name === key) (window as any).__storageAudit.reads += 1; return getItem.call(this, name); };
    Storage.prototype.setItem = function (name, value) { if (name === key) (window as any).__storageAudit.writes += 1; return setItem.call(this, name, value); };
  }, storageKey);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.locator("#desktop-playground")).toBeHidden();
  await expect(page.locator("#playground")).toBeHidden();
  await expect(page.locator("#mobile-playground")).toHaveCount(0);
  await expect(page.locator("#mobile-statusline-example")).toContainText("Codex");
  ({ reads: storageReads, writes: storageWrites } = await page.evaluate(() => (window as any).__storageAudit));
  expect(storageReads).toBe(0);
  expect(storageWrites).toBe(0);
  expect(requests.some((url) => /playground|xterm/i.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-artifacts/task4-mobile.png", fullPage: true });
});

test("release metadata shows one refreshed npm version", async ({ page }) => {
  let releaseRequested!: () => void;
  const releaseRequest = new Promise<void>((resolve) => { releaseRequested = resolve; });
  await page.route("https://registry.npmjs.org/cxstatusline/latest", async (route) => {
    await releaseRequest;
    await route.fulfill({ json: { version: "9.9.9" } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("#release-version")).toHaveText(`v${packageJson.version}`);
  await expect(page.locator("#release-sync")).toHaveText("refreshing");
  releaseRequested();
  await expect(page.locator("#release-version")).toHaveText("v9.9.9");
  await expect(page.locator("#release-sync")).toHaveText("live");
});

test("compatibility is a dedicated support matrix", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const compatibility = page.locator("#compatibility");
  await expect(compatibility.getByRole("heading")).toHaveText("Compatibility matrix.");
  await expect(compatibility).toContainText("0.152.1");
  await expect(compatibility).toContainText("0.154.0");
  await expect(compatibility).not.toContainText("Latest release");
});

test("desktop downloads default settings before any edit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("#playground-skeleton")).toBeHidden();
  await expect(page.locator("#chat-preview")).toBeVisible();
  await expect(page.locator("#download")).toBeEnabled();
  const defaultDownload = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
  const defaultSettings = JSON.parse(await defaultDownload[0].createReadStream().then(async (stream) => { let text = ""; for await (const chunk of stream!) text += chunk; return text; }));
  expect(defaultSettings).toEqual(defaultLayout);
});

test("desktop mounts once, opens the saved editor, reloads, and downloads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await waitForEditor(page);
  const preset = defaultLayout;
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: preset });
  await page.reload();
  await expect(page.locator("#status")).toContainText("Saved in this browser");
  await expect(page.locator("#chat-preview")).toBeVisible();
  await page.locator("#edit").click();
  await waitForEditor(page);
  await expect(page.locator("#terminal")).toContainText("Main Menu");
  await page.reload();
  await expect(page.locator("#status")).toContainText("Saved in this browser");
  await expect(page.locator("#desktop-playground")).toBeVisible();
  await expect(page.locator("#download")).toContainText("Export");
  const frame = await page.locator("body").boundingBox();
  expect(frame?.width).toBe(1440);
  expect((await page.locator(".first-screen").boundingBox())?.height).toBeLessThanOrEqual(900);
  expect((await page.locator(".terminal-window").boundingBox())?.width).toBeGreaterThan(1_320);
  await page.screenshot({ path: "test-artifacts/task4-desktop.png", fullPage: true });

  await expect(page.locator("#download")).toContainText("Export");
  const download = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
  expect(download[0].suggestedFilename()).toBe("cxstatusline-settings.json");
  expect(JSON.parse(await download[0].createReadStream().then(async (stream) => { let text = ""; for await (const chunk of stream!) text += chunk; return text; }))).toHaveProperty("version");
  expect(pageErrors).toEqual([]);
  expect(await page.locator("#terminal .xterm").count()).toBe(1);
});

test("desktop/mobile resize preserves the mounted editor without storage writes", async ({ page }) => {
  let storageWrites = 0;
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    Object.defineProperty(window, "__storageAudit", { value: { writes: 0 }, writable: false });
    Storage.prototype.setItem = function (name, value) { if (name === key) (window as any).__storageAudit.writes += 1; return setItem.call(this, name, value); };
  }, storageKey);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForEditor(page);
  const input = page.locator("#terminal .xterm-helper-textarea");
  await input.focus();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator("#desktop-playground")).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForEditor(page);
  await expect(page.locator("#terminal")).toContainText("Main Menu");
  storageWrites = await page.evaluate(() => (window as any).__storageAudit.writes);
  expect(storageWrites).toBe(0);
});

test("preview rows and installation code copy remain usable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).__copiedCommands = text; } } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForEditor(page);
  const preset = defaultLayout;
  for (const lines of [1, 2, 3]) {
    await page.evaluate(
      ({ key, value, count }) => localStorage.setItem(key, JSON.stringify({ ...value, lines: value.lines.slice(0, count) })),
      { key: storageKey, value: preset, count: lines }
    );
    await page.reload();
    await expect(page.locator("#chat-preview")).toBeVisible();
    await expect(page.locator("#playground-skeleton")).toBeHidden();
    const rowCount = await page.locator("#terminal .xterm-rows > div").count();
    expect(rowCount).toBeGreaterThanOrEqual(lines);
    const bounds = await page.locator("#terminal").boundingBox();
    const screenBounds = await page.locator("#terminal .xterm-screen").boundingBox();
    expect(screenBounds?.height).toBeLessThanOrEqual((bounds?.height ?? 0) + 2);
  }
  await page.locator("#copy-install").click();
  expect(await page.evaluate(() => (window as any).__copiedCommands)).toBe("npm install -g cxstatusline\ncxstatusline install\ncxstatusline doctor");
  await expect(page.locator("#copy-install")).toHaveText("Copied");
  const checks = await page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLElement>("button, input, textarea")];
    return { overflow: document.documentElement.scrollWidth <= window.innerWidth, undersizedControls: controls.filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && (box.width < 28 || box.height < 28); }).length };
  });
  expect(checks.overflow).toBe(true);
  expect(checks.undersizedControls).toBeLessThanOrEqual(1);
});

test("xterm releases Tab focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForEditor(page);

  await terminalKeys(page, ["Tab"]);
  await expect(page.locator("#features-title")).toBeFocused();
  await terminalKeys(page, ["Shift+Tab"]);
  await expect(page.locator("#download")).toBeFocused();
});

test("xterm saves, edits, and discards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForEditor(page);

  await terminalKeys(page, ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "Enter"]);
  await expect(page.locator("#terminal")).toContainText("Save the current configuration and exit?");
  await terminalKeys(page, ["Enter"]);
  await expect(page.locator("#chat-preview")).toBeVisible();
  const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);

  await page.locator("#edit").click();
  await waitForEditor(page);
  await terminalKeys(page, ["Enter", "d", "Enter", "Escape"]);
  await expect(page.locator("#terminal")).toContainText("Main Menu (unsaved changes)");
  await terminalKeys(page, ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "Enter"]);
  await expect(page.locator("#terminal")).toContainText("Discard unsaved changes and exit?");
  await terminalKeys(page, ["Enter"]);
  await expect(page.locator("#chat-preview")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(saved);
});

test("desktop import button loads custom settings and updates preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("#playground-skeleton")).toBeHidden();
  await expect(page.locator("#import")).toBeVisible();
  await expect(page.locator("#import")).toContainText("Import");

  const customLayout = {
    ...defaultLayout,
    lines: [[{ id: "custom-1", type: "git-branch", color: "magenta" }]],
  };

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator("#import").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "custom-settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(customLayout)),
  });

  await expect(page.locator("#status")).toContainText("Saved in this browser");
  const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(saved).not.toBeNull();
  expect(JSON.parse(saved!)).toMatchObject({ lines: [[{ type: "git-branch" }]] });
});

