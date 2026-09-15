# Ink Web Prototype Implementation Plan

> Execute inline using the approved bounded scope. No subagent implementation or deployment.

**Goal:** Run the existing editor in a browser and prove a saved built-in edit.

**Architecture:** One prebundled Ink Web renderer, exact browser aliases, original shared editor, memory-owned settings.

**Tech Stack:** Vite, React 19, Ink Web 0.2.0, xterm, Bun.

**Spec:** ../specs/2026-09-14-ink-web-prototype-design.md

## Global constraints
No WebContainers or shell execution. No edits to node_modules. No editor rewrite. One coherent repair pass followed by build and one browser smoke flow.

## Task 1: Consistent browser dependency graph
- [x] Replace website/vite.config.ts plugin setup with exact Ink Web and Node-boundary aliases. Deduplicate React runtime packages. Preserve original Chalk browser exports.
- [x] Track explicit unsupported fs operations in website/src/fs.ts and fs-promises.ts. Retain fail-closed command/crypto adapter. Alias browser process constants used by application initialization.
- [x] Remove runtime-generation scripts from website/package.json. Declare React DOM directly. Restore only the two known manually patched Ink Web source shims from the exact published tarball; implementation must not depend on transient patches.

## Task 2: Mount and save shared editor
- [x] website/src/main.tsx uses SettingsSchema.parse for defaults, focuses terminal, validates saved settings, and exposes truthful errors for unsupported path import/export.
- [x] Update website/README.md with Ink Web local commands and limitations. Remove obsolete WebContainers runtime files and isolation headers owned by this prototype.

## Task 3: Smallest proof
- [x] Run `rtk bun run build` from website.
- [x] Serve the production build and use Playwright Chromium: click Boot, inspect rendered menu, navigate Colors, change model foreground, Ctrl+S, download and inspect changed JSON. Record result here.
- [x] Report local URL, proof, and any remaining limitation. No extra iteration or deployment.

## Verification result
Production build passed (254 modules; JS 280.47 kB gzip). Playwright MCP profile was occupied, so an isolated local Playwright Chromium browser tested the production preview at http://127.0.0.1:4173/. Actual menu rendered, Colors editor opened, model changed from cyan to white, Ctrl+S saved, downloaded JSON confirmed color white. Zero page errors. Screenshots captured during the edit. First browser run exposed invalid legacy sample IDs; replaced sample with existing schema defaults and rebuilt. No further implementation changes. Safari not tested.
