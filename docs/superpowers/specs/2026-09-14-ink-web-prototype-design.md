# Ink Web prototype design

## Goal and scope
Reuse the existing cxstatusline Ink editor in a static browser page. Prove keyboard navigation, one built-in widget edit, immediate preview update, and saving to a downloadable JSON file. No WebContainers, shell execution, deployment, browser matrix, or editor rewrite.

## Architecture
Use ink-web 0.2.0 prebundled browser renderer. Alias every application `ink` import to this same renderer; do not combine it with the plugin that transforms a separate native Ink installation. Deduplicate React, React DOM, reconciler and scheduler through website dependencies. Keep real Chalk, whose package supplies browser color detection, instead of Ink Web's incomplete Chalk shim.

## Dependency boundary inventory
- Ink/terminal streams/Yoga: owned by the prebundled Ink Web renderer and xterm.
- React/reconciler/scheduler: resolve consistently from website dependencies.
- Chalk: original browser-compatible package, including hex/ANSI256 builders.
- fs and fs/promises: tracked, explicit unsupported-operation exports; no fake writes. App receives initial settings and a browser-memory save callback, so native config IO is not invoked.
- path: installed path-browserify, with exact aliases for both path and node:path.
- os: explicit browser identity; existing browser font notice prevents host-font claims.
- child_process and crypto hashing: fail closed if invoked. Custom Command preview returns before execution/cache logic.
- process: only build-time browser environment/argv values for application modules. Ink owns its internal process compatibility.

## Behavior
Mount automatically on page load (user-requested follow-up). Focus terminal on mount. Preload the saved three-row appearance preset after migration and schema validation; omit custom commands and retain sample telemetry. Save validates/clones settings into browser memory. Download returns the last saved snapshot. Native import/export paths are explicitly unsupported in this POC, rather than pretending to access local files. Report errors in page status. Reload resets this disposable demo.

## Proof
Build once after the coherent adaptation. In Playwright Chromium open the page, click, observe the actual main menu, navigate to Colors, change model foreground, save, and check downloaded JSON. One proof, no broad tests. If a blocker remains report it rather than an unbounded repair loop.
