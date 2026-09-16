# Saved Chat Preview Implementation Plan

> **For agentic workers:** Execute this approved plan in the current workspace. Terra owns implementation and verification; coordinating agent owns design/review. Use executing-plans guidance without extra approval gates.

**Goal:** Save & Exit opens a Codex-style composer with the real configured footer, persisted across reloads.

**Architecture:** Website owns saved settings and two views. Native App gains an optional exit callback. Ink Web continues to render the shared editor and shared statusline. No Node runtime or AI endpoint.

**Tech Stack:** Existing Vite, React 19, Ink Web, xterm, SettingsSchema, localStorage, Bun tests and Playwright.

**Spec:** ../specs/2026-09-14-saved-chat-preview-design.md

## Global constraints
Use current workspace and preserve existing dirty POC work. No deployment, commits, unrelated styling redesign, new runtime, or node_modules edits. No custom-command execution or live session data. Storage failure must not be labeled success. Use rtk for shell commands. Keep proof bounded to one primary browser flow and focused persistence tests.

## Task 1: Browser persistence and embedded exit

Files: website/src/settings-store.ts; website/src/settings-store.test.ts; src/tui/App.tsx; existing test/tui-edit-persistence.test.tsx if callback coverage needs its harness.

Interfaces:
- STORAGE_KEY = "cxstatusline.playground.settings.v1".
- loadSavedSettings(storage: Pick<Storage, "getItem">): { settings: Settings | null; error: string | null }.
- persistSettings(storage: Pick<Storage, "setItem">, value: Settings): Settings returns a validated detached snapshot only after setItem succeeds; throws on failure.
- AppProps.onExit?: () => void preserves native exit when omitted.

Steps:
- [ ] Implement read as getItem -> JSON.parse -> migrateSettings -> SettingsSchema.parse. Null storage value means no saved settings, not failure. Catch invalid/unavailable reads and return a small explanatory error with null settings. Do not delete or replace stored data during recovery.
- [ ] Implement write as SettingsSchema.parse -> JSON serialization -> setItem -> return detached snapshot. Let errors propagate. Caller updates its savedSettings variable only after this returns.
- [ ] Add one test for v2 migration/round-trip, malformed or future-version rejection, and a throwing setItem. Use in-memory getItem/setItem functions, no mocked browser or new framework.
- [ ] Add onExit to AppProps and choose `const { exit: nativeExit } = useApp(); const exit = onExit ?? nativeExit;`. Use that existing local exit variable in every current exit path, including callbacks passed directly. Keep save ordering intact.
- [ ] Run focused Bun tests once after implementation. If shared App callback needs verification, extend existing harness instead of constructing another.

## Task 2: Editor-to-preview state and layout

Files: website/src/main.tsx; optional website/src/PreviewFooter.tsx; website/index.html; website/src/style.css; website/README.md.

State and transitions:
- Start with validated bundled preset; try storage read inside try/catch (accessing window.localStorage itself may throw). If stored settings valid, choose preview; otherwise editor, showing recovery notice when needed.
- `savedSettings: Settings` is replaced only on successful persistSettings. `view: "editor" | "preview"` controls page elements. No draft object is handed back as saved state.
- `writeSettings` persists, assigns returned clone and sets a success notice. Ctrl+S remains editor because App owns that decision.
- `onExit` calls showPreview(savedSettings); it must never call native Ink exit in browser mode. A discarded draft must not overwrite the snapshot. Save & Exit works because App awaits writeSettings first.
- Edit button rerenders App with cloned saved settings, same callback and current path-import restrictions.
- Download serializes savedSettings. Revoke object URL after triggering download, allowing browser consumption.

Steps:
- [ ] Add native textarea and static sample conversation inside panel, hidden in editor view. Textarea label: “Demo message”. Add “Demo only · no messages are sent”. Add Edit statusline action visible in preview; keep download available for saved snapshot.
- [ ] Keep one Ink Web mount and use rerender when possible. Render App in editor and resize-aware StatusLinePreview in preview. The preview wrapper can reuse App's stdout.columns/resize effect, no new render algorithm.
- [ ] Editor uses existing tall terminal. Preview uses compact row-count height directly beneath textarea. Toggle layout before fitting terminal; fit on supported resize path, preserve full width. In preview do not autofocus xterm, remove terminal keyboard focus target if needed, focus textarea instead. In editor focus terminal after mount/rerender.
- [ ] Ensure notices distinguish successful save, discard and read recovery. A failing save remains in editor using existing error feedback.
- [ ] Update README with auto-open behavior, saved/re-edit/download flow, localStorage key, sample-only chat and unimplemented native path IO. Avoid claiming prior Safari test covers new changes.

## Task 3: Bounded verification and delivery

- [ ] Run `rtk bun test website/src/settings-store.test.ts` from repo root and relevant existing TUI persistence tests.
- [ ] Run `rtk bun run build` from website and serve at existing http://127.0.0.1:4173/ (production preview) or a clearly reported available port. Do not launch duplicate servers without checking.
- [ ] Playwright: use MCP if free. If profile is occupied use the known installed Playwright module at /Users/nemesis/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs with isolated Chromium. User authorizes this alternative; no need to request access again.
- [ ] Clear only this app's STORAGE_KEY in the isolated test browser. Open editor, await actual frame, navigate Colors with short render-aware waits between keys, change first widget foreground and note value. Save & Exit via actual menu and confirm. Verify textarea is visible and footer is below it. Type a draft, verify no network AI call is made by implementation.
- [ ] Reopen editor and verify setting retained, then discard an unsaved change and confirm prior saved footer remains. Reload, verify persisted preview. Download JSON and assert original saved value matches. Capture one screenshot and page errors. Avoid more browser/platform testing unless this flow fails.
- [ ] Record exact proof, files and remaining limitations in this plan's execution notes. Return concise report with local URL. No production deployment.

## Execution notes
Implemented 2026-09-14: website storage validates/migrates the existing settings JSON under `cxstatusline.playground.settings.v1`; embedded App exits route to the preview without changing native behavior. The preview uses the shared StatusLinePreview below a local-only textarea, reopens the editor from a cloned saved snapshot, and downloads that snapshot.

Verification: `rtk bun test website/src/settings-store.test.ts`, `rtk bun test test/tui-edit-persistence.test.tsx`, and `rtk bun run build` in `website/` passed. Isolated headless Chromium (Google Chrome executable, Playwright 1.58.2) cleared this storage key, changed the model foreground through the Ink Colors UI to `black`, saved and exited, typed the composer draft, re-edited and discarded a second color edit, reloaded, and verified the stored/downloaded JSON matched the retained `black` setting. No page errors. Screenshot: `/tmp/cxstatusline-saved-chat-preview.png`.

Limitations: this is a local browser demo; textarea content is neither sent nor persisted, and browser path import/export remains unavailable.
