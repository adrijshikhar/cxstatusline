# Codex Patch Architecture Reference

This reference documents the surgical modification points in `codex-rs/tui` maintained by `cxstatusline` patches.

## Overview of Patched Crates

All patches modify `codex-rs/tui`. No other upstream crates (`codex-core`, `codex-protocol`, etc.) are modified unless a compiler attribute (such as `recursion_limit`) is required.

---

## Patched Files and Responsibilities

### 1. `codex-rs/tui/src/chatwidget.rs`
* **Hook Point**: `cxstatusline_pre_draw_tick()`
* **Purpose**: Injects a tick hook right before the terminal frame draws.
* **Location**: Inside `ChatWidget::render()` or pre-draw refresh methods (e.g., adjacent to `refresh_status_line_if_workspace_headline_due()` and `refresh_terminal_program_status()`).
* **Implementation**:
  ```rust
  self.refresh_status_line_if_workspace_headline_due();
  self.cxstatusline_pre_draw_tick();
  self.refresh_thread_usage_if_settlement_due();
  ```

### 2. `codex-rs/tui/src/bottom_pane/chat_composer.rs` & `composer_layout.rs`
* **Hook Point**: Footer layout reservation and height accounting.
* **Purpose**: Ensures 3 terminal lines are reserved for `cxstatusline` footer rows even when multiline drafts, prompt hints, or warning banners are active.
* **Snapshot Tests**: `snapshots/codex_tui__bottom_pane__chat_composer__warning_notice__tests__cxstatusline_three_rows_with_warnings.snap` records layout expectations.

### 3. `codex-rs/tui/src/bottom_pane/footer.rs` & `footer_state.rs`
* **Hook Point**: Footer rendering and shortcut overlay preservation.
* **Purpose**: Preserves all 3 statusline rows during idle state, active typing, command palette/slash menu display, and window resize events.
* **Snapshot Tests**: `snapshots/codex_tui__bottom_pane__footer__tests__cxstatusline_block_preserves_instruction_footer.snap`.

### 4. `codex-rs/tui/src/app/background_requests.rs` & `event_dispatch.rs`
* **Hook Point**: `RateLimitRefreshOrigin::CxStatusLine`
* **Purpose**: Adds a distinct refresh origin for rate limit queries initiated by `cxstatusline` widgets so they do not collide with interactive user-driven refreshes and respect a 5-second timeout.

### 5. `codex-rs/tui/src/status/rate_limits.rs`
* **Hook Point**: Rate limit cache inspection.
* **Purpose**: Exposes cached rate limit quotas to the statusline pre-draw ticker without blocking the UI thread.
