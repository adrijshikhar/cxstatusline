# Ink Web playground

The landing page headings use Geist Sans, downloaded from the official [vercel/geist-font](https://github.com/vercel/geist-font) distribution at the current `main` revision (`fonts/Geist/webfonts/Geist[wght].woff2`). The upstream SIL Open Font License is included at `public/fonts/OFL.txt`.

Local proof using the existing cxstatusline Ink App and preview renderer. No Node runtime boots in the browser.

The first visit opens the editor with a sample. Save & Exit shows a local demo composer and the real saved footer; Edit statusline returns to the same saved configuration. Browser storage uses `cxstatusline.playground.settings.v1`; downloads always contain that saved snapshot. The composer is sample-only and sends nothing. Native path import/export remains unavailable in the browser.

From `website/`, run `rtk bun install`, then `rtk bun run dev`. To serve the production build run `rtk bun run build` then `rtk bun run preview`.

Use the terminal keyboard controls. Ctrl+S saves while editing; Save & Exit opens the composer preview. On reload, a valid browser-saved configuration opens that preview, while no saved configuration opens the sample editor. Path-based import/export and host commands are unavailable; Custom Command only displays its existing placeholder preview. Font detection cannot inspect host fonts.

Ink Web is pinned to 0.2.0. All application Ink imports resolve to its prebundled renderer; native CLI dependencies are unchanged. Browser-only aliases reject host IO instead of silently accepting writes. No dependency source patches are required.

## Cloudflare Pages

The `cxstatusline` Pages project builds from the repository root with `bun install --frozen-lockfile && cd website && bun install --frozen-lockfile && bun run build` and publishes `website/dist`. Production deployments from `main` are disabled pending an intentional release. Preview deployments are limited to `*preview*` and the slash-form companion `preview/*`; their `*.cxstatusline.pages.dev` URLs require Cloudflare Access sign-in as `adrijshikhar26@gmail.com`. The production custom domain is `cxstatusline.adrijshikhar.dev`.
