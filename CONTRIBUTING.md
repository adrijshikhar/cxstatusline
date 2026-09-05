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
See SECURITY.md for sensitive reports.
