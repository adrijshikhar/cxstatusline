# cxstatusline website

Astro 5, Tailwind CSS 4, Anime.js 4, and TypeScript follow the Binsight website stack. `src/pages/index.astro` composes the page; `src/layouts/BaseLayout.astro` owns the document. Section markup belongs in `src/components/`. All authored appearance belongs in `src/styles/`: tokens, shared page styles, and playground styles. No inline styles or embedded style blocks in Astro components. The terminal library owns its runtime-measured geometry.

Page order: hero, full-width desktop playground, explanation/features, local installation, FAQ, footer. Mobile hides the entire playground section and does not boot the editor. Enable the development-only Agentation toolbar with `PUBLIC_ENABLE_AGENTATION=1`.


The landing page uses the approved system sans-serif stack and self-hosted IBM Plex Serif italic for the hero emphasis. Typography is declared in `src/styles/tokens.css`.

Local proof using the existing cxstatusline Ink App and preview renderer. No Node runtime boots in the browser.

The first visit opens the editor with a sample. Save & Exit shows a local demo composer and the real saved footer; Edit statusline returns to the same saved configuration. Browser storage uses `cxstatusline.playground.settings.v1`; downloads always contain that saved snapshot. The composer is sample-only and sends nothing. Native path import/export remains unavailable in the browser.

From `website/`, run `rtk bun install`, then `rtk bun run dev`. To serve the production build run `rtk bun run build` then `rtk bun run preview`.

Use the terminal keyboard controls. Ctrl+S saves while editing; Save & Exit opens the composer preview. On reload, a valid browser-saved configuration opens that preview, while no saved configuration opens the sample editor. Path-based import/export and host commands are unavailable; Custom Command only displays its existing placeholder preview. Font detection cannot inspect host fonts.

Ink Web is pinned to 0.2.0. All application Ink imports resolve to its prebundled renderer; native CLI dependencies are unchanged. Browser-only aliases reject host IO instead of silently accepting writes. No dependency source patches are required.

## Cloudflare Pages

The `cxstatusline` Pages project builds from the repository root with `bun install --frozen-lockfile && cd website && bun install --frozen-lockfile && bun run build` and publishes `website/dist`. Production deployments from `main` are disabled pending an intentional release. Preview deployments are limited to `*preview*` and the slash-form companion `preview/*`; their `*.cxstatusline.pages.dev` URLs require Cloudflare Access sign-in as `adrijshikhar26@gmail.com`. The production custom domain is `cxstatusline.adrijshikhar.dev`.
