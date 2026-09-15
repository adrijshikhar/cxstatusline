import { expect, test, type Page } from "@playwright/test";

const storageKey = "cxstatusline.playground.settings.v1";

async function waitForEditor(page: Page): Promise<void> {
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
  ({ reads: storageReads, writes: storageWrites } = await page.evaluate(() => (window as any).__storageAudit));
  expect(storageReads).toBe(0);
  expect(storageWrites).toBe(0);
  expect(requests.some((url) => /playground|xterm/i.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-artifacts/task4-mobile.png", fullPage: true });
});

test("desktop mounts once, opens the saved editor, reloads, and downloads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await waitForEditor(page);
  const preset = await page.evaluate(() => fetch("/src/sample-settings.json").then((response) => response.json()));
  await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [storageKey, preset]);
  await page.reload();
  await expect(page.locator("#status")).toContainText("Showing saved browser configuration");
  await expect(page.locator("#chat-preview")).toBeVisible();
  await page.locator("#edit").click();
  await waitForEditor(page);
  await expect(page.locator("#terminal")).toContainText("Main Menu");
  await page.reload();
  await expect(page.locator("#status")).toContainText("Showing saved browser configuration");
  await expect(page.locator("#desktop-playground")).toBeVisible();
  await expect(page.locator("#download")).toHaveText("Download saved settings");
  const frame = await page.locator("body").boundingBox();
  expect(frame?.width).toBe(1440);
  expect(await page.locator("#playground").boundingBox()).toMatchObject({ x: 24, width: 1392 });
  await page.screenshot({ path: "test-artifacts/task4-desktop.png", fullPage: true });

  await expect(page.locator("#download")).toHaveText("Download saved settings");
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
  const preset = await page.evaluate(() => fetch("/src/sample-settings.json").then((response) => response.json()));
  for (const lines of [1, 2, 3]) {
    await page.evaluate(([key, value, count]) => localStorage.setItem(key, JSON.stringify({ ...value, lines: value.lines.slice(0, count) })), [storageKey, preset, lines]);
    await page.reload();
    await expect(page.locator("#chat-preview")).toBeVisible();
    const rowCount = await page.locator("#terminal .xterm-rows > div").count();
    expect(rowCount).toBeGreaterThanOrEqual(lines);
    const bounds = await page.locator("#terminal").boundingBox();
    const screenBounds = await page.locator("#terminal .xterm-screen").boundingBox();
    expect(screenBounds?.height).toBeLessThanOrEqual((bounds?.height ?? 0) + 2);
  }
  await page.getByTitle("Copy to clipboard", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedCommands)).toBe("npm install -g cxstatusline\ncxstatusline install\ncxstatusline doctor");
  const checks = await page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLElement>("button, textarea")];
    return { overflow: document.documentElement.scrollWidth <= window.innerWidth, smallTargets: controls.filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && (box.width < 44 || box.height < 44); }).length };
  });
  expect(checks.overflow).toBe(true);
  expect(checks.smallTargets).toBeLessThanOrEqual(1);
});

test("xterm releases Tab focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForEditor(page);

  await terminalKeys(page, ["Tab"]);
  await expect(page.locator('.site-header a[href="#features"]')).toBeFocused();
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
