import { expect, test } from "@playwright/test";

test("opening the editor clears the saved-preview buffer", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  const preset = await page.evaluate(() => fetch("/src/sample-settings.json").then((response) => response.json()));
  await page.evaluate((settings) => localStorage.setItem("cxstatusline.playground.settings.v1", JSON.stringify(settings)), preset);
  await page.reload();

  await expect(page.locator("#status")).toContainText("Showing saved browser configuration");
  await expect(page.locator("#terminal")).toContainText("Model: Codex");
  await page.locator("#edit").click();
  await expect(page.locator("#terminal")).toContainText("Main Menu");

  const terminalText = await page.locator("#terminal").innerText();
  expect(terminalText.match(/Model: Codex/g)).toHaveLength(1);
});
