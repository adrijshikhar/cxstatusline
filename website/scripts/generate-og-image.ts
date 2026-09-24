import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "../..");
const bannerPath = join(rootDir, "docs/banner-dark.png");
const bannerBase64 = readFileSync(bannerPath).toString("base64");
const bannerDataUrl = `data:image/png;base64,${bannerBase64}`;

const outputPath = join(rootDir, "website/public/og-image.png");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    width: 1200px;
    height: 630px;
    background: #090b10;
    color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 40px 48px;
    overflow: hidden;
    position: relative;
    border: 1px solid #1f242e;
  }

  /* Subtle background radial lighting */
  body::before {
    content: "";
    position: absolute;
    top: -150px;
    right: -100px;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(56, 139, 253, 0.08) 0%, rgba(9, 11, 16, 0) 70%);
    pointer-events: none;
  }
  body::after {
    content: "";
    position: absolute;
    bottom: -150px;
    left: -100px;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(63, 185, 80, 0.06) 0%, rgba(9, 11, 16, 0) 70%);
    pointer-events: none;
  }

  /* Top bar */
  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
    z-index: 10;
  }
  .wordmark img {
    height: 38px;
    width: auto;
    display: block;
  }
  .badge-group {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .badge {
    background: #131720;
    border: 1px solid #2d3542;
    color: #58a6ff;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .badge-version {
    background: #161b22;
    border: 1px solid #30363d;
    color: #8b949e;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }

  /* Hero Headline */
  .headline-section {
    position: relative;
    z-index: 10;
    margin-top: 10px;
  }
  .prompt-callout {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 14px;
    color: #58a6ff;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .prompt-callout span {
    color: #8b949e;
  }
  .headline {
    font-size: 32px;
    font-weight: 700;
    color: #f0f6fc;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
  }
  .headline .accent {
    color: #58a6ff;
  }
  .subheadline {
    font-size: 16px;
    color: #8b949e;
    line-height: 1.4;
  }

  /* Authentic Terminal Box */
  .terminal-window {
    background: #0d1117;
    border: 1px solid #262c36;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05);
    position: relative;
    z-index: 10;
    margin-top: 12px;
  }
  .terminal-header {
    background: #161b22;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #21262d;
  }
  .terminal-controls {
    display: flex;
    gap: 7px;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .terminal-title {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    color: #8b949e;
  }
  .terminal-meta {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: #484f58;
  }

  .terminal-body {
    padding: 16px 20px;
    font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .codex-greeting {
    color: #8b949e;
    font-size: 13.5px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .codex-greeting .greeting-bullet {
    color: #58a6ff;
  }
  .codex-prompt {
    background: #161b22;
    border: 1px solid #2d333b;
    border-radius: 6px;
    padding: 9px 14px;
    color: #c9d1d9;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .codex-prompt .arrow {
    color: #58a6ff;
    font-weight: 700;
  }
  .codex-prompt .cursor {
    display: inline-block;
    width: 8px;
    height: 15px;
    background: #58a6ff;
    margin-left: 2px;
    vertical-align: middle;
  }

  .statusline-row {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 4px;
    letter-spacing: -0.01em;
  }
  .statusline-row:last-child {
    margin-bottom: 0;
  }

  /* Colors */
  .c-info { color: #58a6ff; }
  .c-warning { color: #d29922; }
  .c-success { color: #3fb950; }
  .c-purple { color: #bc8cff; }
  .c-cyan { color: #39c5cf; }
  .c-coral { color: #ff7b72; }
  .c-muted { color: #8b949e; }
  .c-dim { color: #484f58; }
  .c-white { color: #f0f6fc; font-weight: 500; }
  .sep { color: #30363d; margin: 0 4px; }

  /* Bottom Tags */
  .bottom-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
    z-index: 10;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #1a1f28;
  }
  .tags-list {
    display: flex;
    gap: 8px;
  }
  .tag {
    background: #11151c;
    border: 1px solid #21262d;
    color: #8b949e;
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  .tag strong {
    color: #e6edf3;
    font-weight: 600;
  }
  .domain-link {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    color: #58a6ff;
    text-decoration: none;
    font-weight: 600;
  }
</style>
</head>
<body>

  <!-- Top bar -->
  <div class="top-bar">
    <div class="wordmark">
      <img src="${bannerDataUrl}" alt="CXSTATUSLINE" />
    </div>
    <div class="badge-group">
      <div class="badge">⚡ OpenAI Codex CLI</div>
      <div class="badge-version">v0.8.0</div>
    </div>
  </div>

  <!-- Headline -->
  <div class="headline-section">
    <div class="prompt-callout">
      &gt; <span>Configure my Codex statusline</span>
    </div>
    <h1 class="headline">OpenAI Codex statusline, <span class="accent">customized.</span></h1>
    <p class="subheadline">Model, context tokens, Git branch, rate limits & usage counters—always visible in your terminal prompt.</p>
  </div>

  <!-- Authentic Terminal Preview -->
  <div class="terminal-window">
    <div class="terminal-header">
      <div class="terminal-controls">
        <span class="dot dot-red"></span>
        <span class="dot dot-yellow"></span>
        <span class="dot dot-green"></span>
      </div>
      <div class="terminal-title">codex — ~/projects/cxstatusline</div>
      <div class="terminal-meta">codex-tui</div>
    </div>
    <div class="terminal-body">
      <div class="codex-greeting">
        <span class="greeting-bullet">•</span>
        <span>Hi! What are we working on today?</span>
      </div>
      <div class="codex-prompt">
        <span class="arrow">&gt;</span>
        <span style="color:#8b949e">Ask Codex to do anything</span>
        <span class="cursor"></span>
      </div>
      <div class="statusline-row">
        <span class="c-info">Model:</span> <span class="c-white">gpt-5-codex</span><span class="sep">|</span><span class="c-coral">Thinking:</span> <span class="c-white">high</span><span class="sep">|</span><span class="c-success">Context:</span> <span class="c-success">[██████░░░░░░░░░░░░]</span> <span class="c-white">42.8k/200k (21%)</span><span class="sep">|</span><span class="c-purple"><svg style="display:inline-block; vertical-align:-1px; margin-right:3px;" width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z"></path></svg>main</span><span class="sep">|</span><span class="c-success">(+42,-10)</span>
      </div>
      <div class="statusline-row">
        <span class="c-warning">Session:</span> <span class="c-white">18m</span><span class="sep">|</span><span class="c-success">Weekly:</span> <span class="c-white">12.0%</span><span class="sep">|</span><span class="c-warning">Weekly Reset:</span> <span class="c-white">1d 12hr 30m</span><span class="sep">|</span><span class="c-cyan">In:</span> <span class="c-white">1,420 t/s</span><span class="sep">|</span><span class="c-cyan">Out:</span> <span class="c-white">84 t/s</span><span class="sep">|</span><span class="c-muted">Cached: 98k</span>
      </div>
      <div class="statusline-row">
        <span class="c-coral">Mem:</span> <span class="c-white">4.2G/16.0G</span><span class="sep">|</span><span class="c-cyan">Session:</span> <span class="c-white">Implement statusline</span><span class="sep">|</span><span class="c-success">SB: ○</span><span class="sep">|</span><span class="c-success">v0.8.0</span><span class="sep">|</span><span class="c-dim">? for shortcuts</span>
      </div>
    </div>
  </div>

  <!-- Bottom Bar -->
  <div class="bottom-bar">
    <div class="tags-list">
      <div class="tag"><strong>36</strong> Modular Widgets</div>
      <div class="tag">Powerline &amp; ANSI Colors</div>
      <div class="tag">Interactive Terminal TUI</div>
      <div class="tag">macOS &amp; Linux</div>
    </div>
    <div class="domain-link">cxstatusline.adrijshikhar.dev</div>
  </div>

</body>
</html>`;

const tempHtmlPath = join(rootDir, "website/public/og-preview.html");
writeFileSync(tempHtmlPath, html, "utf-8");

console.log("Launching headless browser...");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});

await page.setContent(html, { waitUntil: "networkidle" });
// Wait for any fonts/images to settle
await page.waitForTimeout(300);

console.log("Taking screenshot to:", outputPath);
await page.screenshot({ path: outputPath, type: "png" });

await browser.close();
console.log("Done! Generated authentic og-image.png successfully.");
