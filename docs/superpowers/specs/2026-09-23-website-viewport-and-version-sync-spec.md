# Website Viewport Containment & Release Version Sync Specification

## 1. Problem Statement

Two distinct issues have degraded the user experience of `https://cxstatusline.adrijshikhar.dev`:

### Issue 1: Premature Client-Side Version Downgrade (`v0.5.1 · live`)
- **Symptoms**: The site displays `v0.5.1 · live` even though `v0.6.0` is already released on GitHub.
- **Root Cause**: `website/src/main.tsx` (`refreshReleaseVersion()`) queries `https://registry.npmjs.org/cxstatusline/latest`. Because the npm release job (`105836145413`) in GitHub Actions run `35420094706` is paused waiting for manual environment deployment approval for `npm`, the npm registry still returns `0.5.1`. Client-side JavaScript overwrites the static build version (`v0.6.0`) with the stale npm version (`v0.5.1`).
- **Required Behavior**:
  1. The live version badge must never downgrade below the version baked into `package.json` at build time (`v${packageJson.version}`).
  2. The version checker should resolve the latest published version by checking GitHub Releases (or GitHub repository `package.json`) in addition to npm, preferring the highest semver between them.
  3. When an npm or GitHub version is successfully confirmed, the sync indicator shows `live`. If network is offline or unresolvable, it gracefully retains the static version with `v0.6.0 · live`.

### Issue 2: Terminal Window Viewport Overflow in Edit Mode
- **Symptoms**: Clicking `[ Edit layout ]` causes the terminal window to expand downwards past the bottom of the screen. The user's screen develops a vertical scrollbar, pushing the editor action footer (`● Edit in progress...`) and the bottom window border completely off the viewport.
- **Root Cause**:
  1. In `website/src/styles/global.css`, `.terminal-window` has `min-height: calc(100svh - 3rem);` but no `max-height`.
  2. In `website/src/styles/playground.css`, `#terminal` has a rigid `min-height: 24rem;` (384px) and `.terminal-shell` has `max-height: 32rem;` (512px).
  3. Above the editor, `.intro` (ASCII wordmark, prompt line, H1, lede, buttons) occupies ~290px to 320px.
  4. Total height becomes 34px (chrome) + 290px (intro) + 450px (TUI editor) + 44px (playground meta) + 48px (page padding) ≈ 866px to 910px+. On typical laptops (14" MacBook, 13" MacBook, 1080p displays with browser chrome and docks), `window.innerHeight` is only 700px–780px.
- **Required Behavior**:
  1. Desktop `.first-screen` and `.terminal-window` must be strictly bounded to the screen viewport (`height: calc(100svh - 3rem); max-height: calc(100svh - 3rem); overflow: hidden;`). The terminal window must NEVER force the browser page to scroll.
  2. When entering edit mode (`.terminal-window.editing`):
     - The non-essential marketing hero elements inside `.intro` (`.ascii-wordmark`, `.lede`, `.intro-actions`) collapse cleanly.
     - `.intro` transitions to a compact terminal breadcrumb (`> Configure my Codex statusline / OpenAI Codex statusline, customized.`), freeing ~220px of vertical space.
  3. `#terminal` and `.terminal-shell` flex-fill the available vertical space (`min-height: 0; flex: 1 1 auto; height: 100%;`).
  4. `@xterm/addon-fit` automatically recalculates terminal rows to fit the exact available space without overflowing.
  5. When exiting edit mode (Save or Discard), `.editing` is removed and the full marketing hero restores seamlessly.

---

## 2. Technical Architecture

### Component 1: Version Resolution Logic (`website/src/release-sync.ts`)
Extract release checking logic into a dedicated, unit-testable module:
```typescript
export interface ResolvedRelease {
  version: string;
  source: "npm" | "github" | "static";
}

export async function resolveLatestVersion(staticVersion: string, fetchFn: typeof fetch = fetch): Promise<ResolvedRelease>
```
- Fetches `https://registry.npmjs.org/cxstatusline/latest` and `https://raw.githubusercontent.com/adrijshikhar/cxstatusline/main/package.json` concurrently with a 4-second timeout.
- Compares semantic versions (`staticVersion`, `npmVersion`, `githubVersion`).
- Returns the highest semver. If remote checks fail or return older versions, returns `{ version: staticVersion, source: "static" }`.
- Guarantees the site never displays a version lower than `staticVersion`.

### Component 2: Viewport CSS Rules (`website/src/styles/global.css` & `playground.css`)
- In `global.css`:
  ```css
  @media (min-width: 769px) {
    .first-screen {
      height: 100svh;
      max-height: 100svh;
      overflow: hidden;
      padding-block: 1.5rem;
    }
    .terminal-window {
      height: calc(100svh - 3rem);
      max-height: calc(100svh - 3rem);
      overflow: hidden;
    }
    .terminal-window-body {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
  }
  ```
- In `playground.css`:
  ```css
  /* Compact intro when in editing mode */
  .terminal-window.editing .ascii-wordmark,
  .terminal-window.editing .lede,
  .terminal-window.editing .intro-actions {
    display: none;
  }
  .terminal-window.editing .intro {
    padding-block: 0.5rem 0.25rem;
    gap: 0.25rem;
  }
  .terminal-window.editing #desktop-playground {
    flex: 1 1 auto;
    min-height: 0;
  }
  .terminal-window.editing .terminal-shell {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
    height: 100%;
  }
  .terminal-window.editing #terminal {
    min-height: 0;
    height: 100%;
  }
  ```

### Component 3: Playground Lifecycle Integration (`website/src/playground.tsx`)
- In `renderEditor()`:
  - Add `editing` class to `.terminal-window`.
  - Trigger `window.dispatchEvent(new Event("resize"))` so xterm fit addon recalculates geometry for the enlarged editor space.
- In `showPreview()`:
  - Remove `editing` class from `.terminal-window`.
  - Trigger `window.dispatchEvent(new Event("resize"))`.

---

## 3. Verification & Testing

1. **Unit Tests (`website/test/release-sync.test.ts`)**:
   - Asserts that npm version > static version updates correctly.
   - Asserts that when npm returns older version (e.g. 0.5.1 vs static 0.6.0), GitHub/static version takes precedence.
   - Asserts that network failure falls back cleanly to static version.
2. **Playwright E2E Tests (`website/test/edit-preview.spec.ts`)**:
   - Asserts at laptop viewport (1280x720 and 1440x900) that entering edit mode keeps `.first-screen` height `<= window.innerHeight`.
   - Asserts that `.terminal-window` bounding box bottom is `<= window.innerHeight`.
   - Asserts that `document.documentElement.scrollHeight <= window.innerHeight` during editing (no page scrollbar created).
   - Asserts that exiting edit mode restores `.intro` elements.
