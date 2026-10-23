# Resolving Upstream Codex Patch Conflicts

When upstream OpenAI Codex introduces refactors to `codex-rs/tui`, `python3 scripts/codex_port.py patch <version>` may report conflicts during `git apply --check`.

This guide walks through systematically resolving these conflicts.

---

## Step 1: Identify Conflicted Hunks

When conflicts occur, `codex_port.py` runs `git apply --reject`, generating `.rej` files in `/tmp/codex-<version>`.

Inspect reject files:
```bash
find /tmp/codex-<version> -name "*.rej"
```

Common conflicted files:
1. `codex-rs/tui/src/chatwidget.rs` (pre-draw tick hook moved or renamed)
2. `codex-rs/tui/src/bottom_pane/chat_composer.rs` (composer layout struct changes)
3. `codex-rs/tui/src/bottom_pane/footer.rs` (footer rendering methods reordered)

---

## Step 2: Inspect Upstream Commit History

Query git log between the last supported tag and the target tag for TUI changes:
```bash
git -C /tmp/codex-<version> log --oneline rust-v<previous>..rust-v<target> -- codex-rs/tui/
```

Look for commits modifying:
- `ChatWidget::render`
- `ComposerLayout` or `ChatComposer`
- `Footer` or `FooterState`
- Terminal event loop or background request dispatch

---

## Step 3: Resolve Hunks in Upstream Worktree

Navigate to `/tmp/codex-<version>` and edit the target files:
1. **Pre-Draw Tick**: Locate the method where statusline and terminal titles refresh before ratatui draws frames (usually in `chatwidget.rs` or `status_surfaces.rs`). Re-insert `self.cxstatusline_pre_draw_tick();`.
2. **Footer Height**: Check where `footer_height` or `chat_composer_layout` calculates row counts. Ensure 3 rows remain reserved for `cxstatusline`.
3. **Snapshot Tests**: If upstream changed surrounding text or layout borders, update the insta snapshot files under `codex-rs/tui/src/bottom_pane/snapshots/`.

---

## Step 4: Extract Clean Diff

Once all files in `/tmp/codex-<version>` are resolved:
1. Verify the worktree state:
   ```bash
   git -C /tmp/codex-<version> diff
   ```
2. Remove any `.rej` and `.orig` files:
   ```bash
   find /tmp/codex-<version> -name "*.rej" -delete
   find /tmp/codex-<version> -name "*.orig" -delete
   ```
3. Stage changes and export the patch:
   ```bash
   git -C /tmp/codex-<version> add -A
   git -C /tmp/codex-<version> diff --cached > patches/codex-<version>.patch
   ```

---

## Step 5: Update Manifest and Verify

1. Run `python3 scripts/codex_port.py patch <version>` (it will now pass cleanly).
2. Run `python3 scripts/codex_port.py verify <version>` to confirm test suite and package check pass.
