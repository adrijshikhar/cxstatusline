# Saved configuration chat preview design

## Goal
After Save & Exit, show how the configured footer looks beneath a Codex-style message composer. Reuse the real Ink editor and statusline renderer; no WebContainers, duplicate editor, AI service, or deployment.

## Current verified baseline
website/src/main.tsx automatically mounts src/tui/App.tsx through ink-web 0.2.0. All Ink imports resolve to one bundled browser renderer via website/vite.config.ts. The three-row sample mirrors the local appearance with custom-command widgets removed. The editor and saved download work in automated Chromium; user confirmed Safari. Native App calls useApp().exit() and currently terminates the embedded UI. Settings currently live only in memory.

## Views and transitions
1. First visit with no saved valid configuration: editor opens automatically with the bundled sample.
2. Save (Ctrl+S): validate and persist a snapshot; stay in editor, preserve existing success feedback.
3. Save & Exit: existing confirmation remains. Persist successfully, then replace editor with chat preview. Show “Configuration saved in this browser.”
4. Exit Without Saving (or Ctrl+C): return to preview using last successfully saved snapshot, or the bundled sample if never saved. Do not persist drafts or show a false save confirmation.
5. Edit statusline: reopen App with a cloned saved snapshot. Unsaved edits must not mutate saved state.
6. Reload: valid persisted settings open chat preview; absent/invalid settings open editor with sample. A malformed/unsupported stored value is not silently overwritten. Explain fallback briefly.
7. Download saved configuration: JSON of the same validated saved snapshot driving the preview. Never export the current unsaved draft.

## Chat preview appearance
Keep existing page styling and restrained scope. Inside the main terminal-like panel, show a small static sample conversation area and a multiline native textarea with an accessible label (for example “Demo message”). Composer uses a dark-gray rectangular surface, monospace text and a visible focus indicator, inspired by the supplied screenshot. The actual rendered statusline sits directly below the composer, one to three rows with no large empty terminal area between them. Responsive width controls the real renderer's truncation. The footer is display-only and must not steal keyboard input from the textarea.

Text entered stays only in component/page memory. It is not sent or persisted. No fake AI response, send request, credentials, screenshot session ID, or real session telemetry. A visible “Demo only · no messages are sent” label makes this clear. Enter inserts a newline. No simulated backend is necessary.

## State ownership and storage
website owns view state, saved snapshot and local persistence. Use one stable key: cxstatusline.playground.settings.v1. Store the existing settings JSON format, not an invented envelope. Read with JSON.parse -> migrateSettings -> SettingsSchema.parse. Treat storage as untrusted input. Catch unavailable localStorage, malformed JSON and unsupported schema; show sample without mutating the stored value. Save validates/clones first, writes localStorage, then updates saved memory and UI. If persistence throws, reject writeSettings so existing App error handling retains editor/draft and prior saved state. Do not claim browser persistence when it failed. Never access the installed CLI settings from browser.

## Shared App exit seam
Add one optional AppProps.onExit: () => void. App obtains native useApp().exit and uses onExit when supplied, native exit otherwise. Route every existing exit path through that choice. Keep CLI save/discard logic unchanged. Website writeSettings remains the persistence boundary; onExit only changes view. Do not add browser globals, DOM APIs or storage access to native TUI source.

## Renderer lifecycle
Prefer one mounted Ink Web instance and its existing rerender method to switch between App and a small preview-footer component. Footer component uses actual StatusLinePreview with current stdout.columns and resize subscription. Existing App handles editor resizing. Place/show composer above the terminal when preview is selected; compact terminal container height to saved row count. Restore editor height when editing. Trigger fitting through the supported resize mechanism; do not introduce a second editor or ANSI-to-HTML parser. No accumulating keyboard/resize listeners across transitions. In preview focus composer and make terminal noninteractive; when editing focus xterm. If maintaining a single mount proves unsuitable, explicit unmount-before-remount is acceptable, with the same invariant of one active terminal.

## Browser-only boundaries
Keep current exact Vite aliases and real Chalk browser implementation. Existing explicit host IO failures remain. Custom commands only display the existing preview placeholder and cannot execute. Existing native path import/export remains outside this POC; retain clear error behavior. Do not copy command strings or private telemetry into assets.

## Files and ownership
- src/tui/App.tsx: optional embedded exit callback only.
- website/src/main.tsx: transition controller, shared terminal mount, download and focus.
- website/src/settings-store.ts: small storage load/save functions with schema validation; no class/service.
- website/src/PreviewFooter.tsx: only if useful for resize-aware reuse of StatusLinePreview.
- website/index.html and website/src/style.css: composer, transcript, action visibility and compact/footer layout.
- website/README.md: workflow and local persistence/limitations.
- website/src/settings-store.test.ts: focused storage failure/round-trip check using Bun's existing test capability.
- Existing test/tui-edit-persistence.test.tsx: one callback/default behavior check if needed; reuse its harness, no framework.

## Acceptance and proof
A single bounded browser flow: editor -> change model appearance -> Save & Exit + confirm -> composer and footer visible -> type text -> Edit statusline -> saved change still present -> return preview -> reload restores -> download JSON matches saved value. Check no page errors. One source test covers invalid stored data and failed writes leaving last saved snapshot intact. Build passes. Preserve CLI behavior with existing focused TUI persistence checks if App is changed. No exhaustive browser matrix, performance project, extra iterations or deployment. Save one reviewable screenshot of preview and report exact tested browser; do not claim Safari automated coverage based on user's older test.
