# Website Viewport Containment & Release Version Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the website's terminal window expanding beyond the screen in edit layout mode, and prevent client-side version downgrades from npm when GitHub or static build has a newer version.

**Architecture:** Extract release version resolution into an isolated testable module with multi-source fallback (GitHub + npm + static) and no-downgrade guarantee. Constrain desktop `.first-screen` and `.terminal-window` to `100svh` with strict `overflow: hidden`, compact the marketing hero when in edit mode via `.terminal-window.editing`, and allow xterm to flex-fill the exact available vertical space.

**Tech Stack:** Astro, TypeScript, Tailwind CSS, Ink-web / xterm.js, Playwright, Bun test.

**Spec:** [`docs/superpowers/specs/2026-09-23-website-viewport-and-version-sync-spec.md`](file:///Users/nemesis/Projects/my-projects/cxstatusline/docs/superpowers/specs/2026-09-23-website-viewport-and-version-sync-spec.md)

## Global Constraints

- Never push directly to `main`; all work on a dedicated branch with PR.
- Strict viewport containment on desktop (>=769px): `.terminal-window` must never exceed `calc(100svh - 3rem)` and must never create a page scrollbar.
- Zero version downgrades: The version badge must never display a version lower than the static package version (`0.6.0`).
- Seamless transitions: Exiting edit mode must restore the full marketing hero without layout glitches.
- All tests (`bun test ./test ./src`, `bun run test:website`, `bun run test:website:e2e`, `bun run typecheck`) must pass.

---

### Task 1: Client-Side Release Version Resolution Module

**Files:**
- Create: `website/src/release-sync.ts`
- Create: `website/test/release-sync.test.ts`
- Modify: `website/src/main.tsx:12-30`

**Interfaces:**
- Consumes: `staticVersion: string` from `website/package.json`
- Produces: `resolveLatestVersion(staticVersion: string, fetchFn?: typeof fetch): Promise<ResolvedRelease>`

- [ ] **Step 1: Write the failing unit tests for `release-sync.ts`**

Create `website/test/release-sync.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { compareSemver, resolveLatestVersion } from "../src/release-sync";

describe("compareSemver", () => {
  test("compares versions accurately", () => {
    expect(compareSemver("0.6.0", "0.5.1")).toBeGreaterThan(0);
    expect(compareSemver("0.5.1", "0.6.0")).toBeLessThan(0);
    expect(compareSemver("0.6.0", "0.6.0")).toBe(0);
  });
});

describe("resolveLatestVersion", () => {
  test("retains static version when npm is older (e.g. 0.5.1 vs static 0.6.0)", async () => {
    const mockFetch: typeof fetch = async (url) => {
      if (String(url).includes("registry.npmjs.org")) {
        return new Response(JSON.stringify({ version: "0.5.1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 });
    };

    const result = await resolveLatestVersion("0.6.0", mockFetch);
    expect(result.version).toBe("0.6.0");
  });

  test("upgrades when npm returns a newer version", async () => {
    const mockFetch: typeof fetch = async (url) => {
      if (String(url).includes("registry.npmjs.org")) {
        return new Response(JSON.stringify({ version: "0.7.0" }), { status: 200 });
      }
      return new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 });
    };

    const result = await resolveLatestVersion("0.6.0", mockFetch);
    expect(result.version).toBe("0.7.0");
    expect(result.source).toBe("npm");
  });

  test("falls back to GitHub when npm is offline or failing", async () => {
    const mockFetch: typeof fetch = async (url) => {
      if (String(url).includes("registry.npmjs.org")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (String(url).includes("raw.githubusercontent.com")) {
        return new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    const result = await resolveLatestVersion("0.5.1", mockFetch);
    expect(result.version).toBe("0.6.0");
    expect(result.source).toBe("github");
  });

  test("returns static version when all network checks fail", async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error("Network offline");
    };

    const result = await resolveLatestVersion("0.6.0", mockFetch);
    expect(result.version).toBe("0.6.0");
    expect(result.source).toBe("static");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website && bun test test/release-sync.test.ts`
Expected: FAIL (module `../src/release-sync` not found).

- [ ] **Step 3: Implement `website/src/release-sync.ts`**

Create `website/src/release-sync.ts`:
```typescript
export interface ResolvedRelease {
  version: string;
  source: "npm" | "github" | "static";
}

export function compareSemver(left: string, right: string): number {
  const [lMaj = 0, lMin = 0, lPat = 0] = left.split(".").map(Number);
  const [rMaj = 0, rMin = 0, rPat = 0] = right.split(".").map(Number);
  return lMaj - rMaj || lMin - rMin || lPat - rPat;
}

export async function resolveLatestVersion(
  staticVersion: string,
  fetchFn: typeof fetch = fetch,
): Promise<ResolvedRelease> {
  let highest = { version: staticVersion, source: "static" as const };

  const checkSource = async (
    url: string,
    sourceName: "npm" | "github",
    parseFn: (data: unknown) => string | null,
  ): Promise<void> => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 4_000);
    try {
      const res = await fetchFn(url, { signal: abort.signal });
      if (!res.ok) return;
      const data = await res.json();
      const ver = parseFn(data);
      if (ver && compareSemver(ver, highest.version) > 0) {
        highest = { version: ver, source: sourceName };
      }
    } catch {
      // Ignore network failures and timeouts; fallbacks will apply
    } finally {
      clearTimeout(timeout);
    }
  };

  await Promise.allSettled([
    checkSource("https://registry.npmjs.org/cxstatusline/latest", "npm", (data) =>
      typeof data === "object" && data !== null && "version" in data && typeof data.version === "string"
        ? data.version
        : null,
    ),
    checkSource(
      "https://raw.githubusercontent.com/adrijshikhar/cxstatusline/main/package.json",
      "github",
      (data) =>
        typeof data === "object" && data !== null && "version" in data && typeof data.version === "string"
          ? data.version
          : null,
    ),
  ]);

  return highest;
}
```

- [ ] **Step 4: Update `website/src/main.tsx` to use `resolveLatestVersion`**

In `website/src/main.tsx`, import `resolveLatestVersion` and replace `refreshReleaseVersion()`:
```typescript
import { resolveLatestVersion } from "./release-sync";
import packageJson from "../package.json";

async function refreshReleaseVersion(): Promise<void> {
  if (!releaseSync) return;
  try {
    const staticVer = packageJson.version;
    const resolved = await resolveLatestVersion(staticVer, window.fetch.bind(window));
    if (releaseVersion) releaseVersion.textContent = `v${resolved.version}`;
    releaseSync.textContent = "live";
    releaseSync.title = resolved.source === "npm" ? "Live npm release" : resolved.source === "github" ? "Live GitHub release" : "Latest release";
  } catch {
    releaseSync.textContent = "live";
    releaseSync.title = "Offline release info";
  }
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd website && bun test test/release-sync.test.ts`
Expected: PASS (all 5 tests pass).

- [ ] **Step 6: Commit**

```bash
git add website/src/release-sync.ts website/test/release-sync.test.ts website/src/main.tsx
git commit -m "fix(website): prevent release version downgrade and add GitHub fallback"
```

---

### Task 2: Viewport Containment & Compact Edit Layout CSS

**Files:**
- Modify: `website/src/styles/global.css:26-38`
- Modify: `website/src/styles/playground.css:1-24`

**Interfaces:**
- Consumes: DOM classes `.terminal-window`, `.terminal-window.editing`, `.intro`, `.terminal-shell`
- Produces: Strict viewport bounds on desktop and compact layout rules when editing.

- [ ] **Step 1: Update `website/src/styles/global.css`**

In `website/src/styles/global.css`, replace `.first-screen`, `.terminal-window`, and `.terminal-window-body` rules around lines 26–38:
```css
.first-screen {
  display: grid;
  min-height: 100svh;
  padding-block: 1.5rem;
}
@media (min-width: 769px) {
  .first-screen {
    height: 100svh;
    max-height: 100svh;
    overflow: hidden;
  }
}
#terminal-hero {
  display: grid;
  width: min(calc(100% - 2 * var(--page-gutter)), 96%);
  align-self: stretch;
  --terminal: var(--surface);
}
.terminal-window {
  display: grid;
  grid-template-rows: 2.125rem minmax(0, 1fr);
  min-height: calc(100svh - 3rem);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 0.75rem;
  background: var(--terminal);
  box-shadow: 0 1.5rem 5rem rgba(0, 0, 0, .28);
}
@media (min-width: 769px) {
  .terminal-window {
    height: calc(100svh - 3rem);
    max-height: calc(100svh - 3rem);
  }
}
.terminal-window-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
```

- [ ] **Step 2: Update `website/src/styles/playground.css`**

In `website/src/styles/playground.css`:
```css
#desktop-playground {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: var(--terminal);
}
.terminal-shell {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: var(--terminal);
}
.terminal-output {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  font-size: .875rem;
  line-height: 1rem;
}
.terminal-output > * { grid-area: 1 / 1; min-width: 0; }
.preview .terminal-output {
  flex: 0 0 auto;
  height: calc(3lh + 1.25rem);
  overflow: hidden;
}
#playground-skeleton { z-index: 1; padding-inline: var(--terminal-inset); background: var(--terminal); }
#terminal {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  max-width: calc(100% - 2 * var(--terminal-inset));
  margin-inline: var(--terminal-inset);
  overflow: hidden;
}
.terminal-shell:not(.preview) #terminal {
  padding-top: clamp(0.5rem, 1vw, 0.875rem);
}
.terminal-shell.preview {
  flex: 0 0 auto;
  max-height: 15rem;
  overflow: visible;
}
.preview #terminal {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

/* Compact marketing hero in edit mode */
.terminal-window.editing .ascii-wordmark,
.terminal-window.editing .lede,
.terminal-window.editing .intro-actions {
  display: none !important;
}
.terminal-window.editing .intro {
  flex: 0 0 auto;
  padding: 0.75rem var(--terminal-inset) 0.5rem;
  gap: 0.25rem;
}
.terminal-window.editing .intro h1 {
  font-size: 1rem;
  line-height: 1.3;
}
```

- [ ] **Step 3: Run build and typecheck to verify CSS & Astro syntax**

Run: `cd website && bun run build`
Expected: Build succeeds cleanly.

- [ ] **Step 4: Commit**

```bash
git add website/src/styles/global.css website/src/styles/playground.css
git commit -m "fix(website): lock desktop terminal to viewport and compact intro in edit mode"
```

---

### Task 3: Playground Lifecycle Integration & Dynamic Xterm Fit

**Files:**
- Modify: `website/src/playground.tsx:90-125`

**Interfaces:**
- Consumes: `.terminal-window` DOM element, `renderEditor()`, `showPreview()`
- Produces: Adding/removing `editing` class on `.terminal-window` and triggering resize on view change.

- [ ] **Step 1: Update `renderEditor()` and `showPreview()` in `website/src/playground.tsx`**

In `website/src/playground.tsx`:
```typescript
const terminalWindow = document.querySelector<HTMLElement>(".terminal-window");

async function renderEditor(): Promise<void> {
  view = "editor";
  chat.hidden = true;
  editButton.hidden = true;
  terminalWindow?.classList.add("editing");
  shell.classList.remove("preview");
  setEditorStatus();
  terminalElement.inert = true;
  if (!mounted) return;
  await mounted.unmount();
  terminalElement.replaceChildren();
  if (view !== "editor") return;
  mountView(editorView(), () => {
    terminalElement.inert = false;
    focusCurrentView();
    // Dispatch resize so fit addon immediately aligns with the compact container
    window.dispatchEvent(new Event("resize"));
  });
}

function showPreview(focus = true, rerender = true): void {
  view = "preview";
  chat.hidden = false;
  editButton.hidden = false;
  terminalWindow?.classList.remove("editing");
  shell.classList.add("preview");
  terminalElement.inert = true;
  if (mounted) {
    mounted.term.options.disableStdin = true;
    if (rerender) {
      mounted.term.reset();
      mounted.rerender(<PreviewFooter settings={savedSettings} />);
    }
  }
  setStatus(hasSavedSettings ? "Saved in this browser" : "Default settings preview", hasSavedSettings ? "status-saved" : "status-muted");
  window.dispatchEvent(new Event("resize"));
  if (focus) focusCurrentView();
}
```

- [ ] **Step 2: Build the website**

Run: `cd website && bun run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add website/src/playground.tsx
git commit -m "fix(website): toggle editing state on terminal window and fit xterm dynamically"
```

---

### Task 4: Automated Verification (Playwright E2E Tests for Viewport Containment)

**Files:**
- Modify: `website/test/edit-preview.spec.ts`

**Interfaces:**
- Consumes: Playwright browser environment running against preview server.
- Produces: Automated assertions verifying that entering edit mode at 1280x720 and 1440x900 viewports never overflows the viewport.

- [ ] **Step 1: Add viewport containment test to `website/test/edit-preview.spec.ts`**

Add the following test to `website/test/edit-preview.spec.ts`:
```typescript
test("desktop edit mode stays completely contained within laptop viewports without scrolling", async ({ page }) => {
  // Test both a tight 1280x720 laptop screen and standard 1440x900
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#playground-skeleton")).toBeHidden();
    await expect(page.locator("#edit")).toBeVisible();

    // Click Edit layout
    await page.locator("#edit").click();
    await waitForEditor(page);

    // Verify terminal-window has editing class
    await expect(page.locator(".terminal-window")).toHaveClass(/editing/);

    // Verify ASCII wordmark and lede are collapsed to save vertical space
    await expect(page.locator(".ascii-wordmark")).toBeHidden();
    await expect(page.locator(".lede")).toBeHidden();

    // Verify the terminal window bottom does NOT exceed viewport height
    const windowBounds = await page.locator(".terminal-window").boundingBox();
    expect(windowBounds).not.toBeNull();
    expect(windowBounds!.y + windowBounds!.height).toBeLessThanOrEqual(viewport.height);

    // Verify document does not require vertical scrolling
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollHeight).toBeLessThanOrEqual(viewport.height);

    // Verify footer bar with action buttons is fully visible
    await expect(page.locator(".playground-meta")).toBeVisible();
    const metaBounds = await page.locator(".playground-meta").boundingBox();
    expect(metaBounds).not.toBeNull();
    expect(metaBounds!.y + metaBounds!.height).toBeLessThanOrEqual(viewport.height);

    // Capture screenshot artifact for verification
    await page.screenshot({ path: `test-artifacts/edit-mode-viewport-${viewport.width}x${viewport.height}.png` });

    // Exit edit mode and verify full hero restores
    await terminalKeys(page, ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "Enter"]);
    await page.locator(".terminal-window").click(); // Dismiss prompt if needed
  }
});
```

- [ ] **Step 2: Run all Playwright tests**

Run: `cd website && bun run test:e2e`
Expected: PASS (all tests pass, including the new viewport containment tests at both 1280x720 and 1440x900).

- [ ] **Step 3: Commit**

```bash
git add website/test/edit-preview.spec.ts
git commit -m "test(website): add automated viewport containment assertions for laptop screens"
```

---

### Task 5: End-to-End Regression & PR Creation

- [ ] **Step 1: Run complete repository verification suite**
Run:
- `bun test ./test ./src`
- `bun run test:website`
- `bun run test:website:e2e`
- `bun run typecheck`
- `cd website && bunx tsc --noEmit`
- `bun run check:package`

- [ ] **Step 2: Push branch and open Pull Request**
Create descriptive branch `fix/website-edit-mode-viewport-and-version-sync`, push, and open PR via `gh pr create`.
