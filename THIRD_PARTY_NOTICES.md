# Third-party notices

## ccstatusline-derived artifact provenance

The Ink patch and selected renderer/configuration components are adapted from
[`sirmalloc/ccstatusline`](https://github.com/sirmalloc/ccstatusline), pinned to upstream commit
`6a3d855b82faf75b249155dcfa1624780f89cbbd`.

Included patch:

- `patches/ink@6.2.0.patch` — the Ink macOS backspace fix, copied byte-for-byte from that pinned
  upstream checkout.

The settings, rendering, widget, and configuration TUI ports derive selected behavior from
`src/types/`, `src/utils/`, `src/widgets/`, and `src/tui/` at that pinned commit. In particular,
`src/tui/{App,index}.tsx` and `src/tui/components/` retain the Ink navigation, picker, color,
override, confirmation, and preview behavior adapted for the closed Codex widget catalog.
The Powerline setup, separator/cap editor, theme selector, and gradient override controls are
adapted from the same pinned source.
The export/import path dialogs and import-preview interaction are adapted from the same source;
cxstatusline's strict mapping and confirmation-only save policy are local adaptations.
Claude-specific integrations, font installation, update flows, external-browser actions, and
excluded widgets are not copied.

## Bundled dependencies and Codex

`bun run build` generates `dist/THIRD_PARTY_LICENSES.txt` from the bundle's actual
dependency inputs. This file is included in the npm tarball alongside these notices.
It preserves dependency license and notice files, including notices within distributed
dependency bundles. Review this inventory when updating dependencies.

OpenAI Codex is separately licensed under Apache-2.0. The current source installer
fetches its source and builds it locally; the npm package does not contain Codex binaries.
Native prebuilt distribution requires its own upstream and dependency license audit.

## ccstatusline license

Copyright (c) 2025 Matthew Breedlove (https://github.com/sirmalloc)

The upstream code is available under the following MIT License:

MIT License

Copyright (c) 2025 Matthew Breedlove (https://github.com/sirmalloc)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
