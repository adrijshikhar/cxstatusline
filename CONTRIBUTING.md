# Contributing

Keep changes small. Discuss larger changes in an issue first. Use Node 22+ and Bun 1.4+.

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run check:package
```

The package check installs a tarball into a temporary directory and exercises it with Node;
it does not patch your Codex. The build regenerates dependency notices from actual bundle
inputs and fails on missing license text. Reviewed supplements live in `licenses/`.

To check the supported patches against disposable worktrees of an existing upstream clone:

```sh
CXSTATUSLINE_CODEX_CHECKOUT=/absolute/path/to/codex bun test test/patch-applies.test.ts
```

This checks indexed application twice, not a full Rust build. Without a checkout that test
is intentionally skipped. Native CI builds are separate and substantially more expensive.

Preserve copied ccstatusline UI/widget behavior and attribution. Unsupported Claude integrations
and custom commands remain outside the catalog. No `@ts-nocheck`. Include reproduction and test
evidence in PRs. Never commit credentials, personal settings, logs or private planning documents.
See [SECURITY.md](SECURITY.md) for sensitive reports.

## Branching & Pull Requests

Direct pushes to `main` are strictly blocked. All contributions—whether from humans or AI agents—must follow this workflow:

1. Create a dedicated branch: `git checkout -b <type>/<description>` (e.g. `feat/...`, `fix/...`, `chore/...`).
2. Verify all local checks pass: `bun test && bun run typecheck && bun run build && bun run check:package`.
3. Push your branch: `git push -u origin <branch-name>`.
4. Open a Pull Request using Conventional Commits format in the title (e.g. `fix: ...` or `feat: ...`).


## Adding a new Codex version

To add support for a newly released upstream Codex version:

1. Check if the existing candidate patch applies cleanly to the new tag:
   ```sh
   git -C /path/to/openai/codex checkout rust-v<NEW_VERSION>
   git -C /path/to/openai/codex apply --check /path/to/patches/codex-<CANDIDATE>.patch
   ```
2. If it applies cleanly, copy the patch to `patches/codex-<NEW_VERSION>.patch`. If upstream changes broke the patch, adjust it cleanly while preserving the additive hook interface.
3. Update `patches/manifest.json`: add an entry with `"min": "<NEW_VERSION>"`, `"max": "<NEW_VERSION>"`, `"file": "codex-<NEW_VERSION>.patch"`, and bump `"candidate": "<NEW_VERSION>"`.
4. Add `<NEW_VERSION>` to the `codex_version` choices in `.github/workflows/prebuilt.yml`.
5. Run the patch apply test against an upstream checkout:
   ```sh
   CXSTATUSLINE_CODEX_CHECKOUT=/path/to/openai/codex bun test test/patch-applies.test.ts
   ```
6. Run local checks: `bun test && bun run typecheck && bun run build && bun run check:package`.

## Dispatching the release workflow

The prebuilt release pipeline is defined in `.github/workflows/prebuilt.yml`:

- **Manual dispatch:** In GitHub Actions → *Prebuilt release* → *Run workflow*:
  - `codex_version`: `auto` (to detect the latest stable upstream release) or an exact version (e.g. `0.153.4`).
  - `publish`: `false` for a build-and-verify run; `true` to publish the release.
  - `self_hosted`: `true` to run on the arm64 self-hosted runner; `false` to use hosted runners.
  - The pipeline runs `detect → validate → native → publish → report`.

## Regenerate the README demo

Install [VHS](https://github.com/charmbracelet/vhs) (`brew install vhs` on macOS),
then run `bun run demo` from the repository root. VHS also requires ttyd and ffmpeg;
Homebrew installs its dependencies. The recording drives the real configurator using
built-in sample previews, `docs/demo-settings.json`, and a fresh temporary XDG config
directory, never your settings.
It does not start or patch Codex. Temporary demo settings remain under
`/tmp/cxstatusline-demo.*` for inspection.

Edit `docs/demo.tape` when menu navigation changes, regenerate `docs/demo.gif`, and
watch the animation before committing both. Open it in a browser (macOS Preview shows
individual frames). Keep sample data in recordings; do not record personal sessions.
