# Code Translation Guide

This reference dictionary provides standardized rules and translation patterns for converting upstream code from `sirmalloc/ccstatusline` (Claude Code) to `cxstatusline` (OpenAI Codex).

---

## 1. Identifiers, Namespaces & Paths

| Upstream (`ccstatusline`) | Ported (`cxstatusline`) | Notes |
|---|---|---|
| `ccstatusline` | `cxstatusline` | Package name, command name, executable |
| `CCSTATUSLINE_WIDTH` | `CXSTATUSLINE_WIDTH` | Use fallback pattern: `process.env.CXSTATUSLINE_WIDTH ?? process.env.CCSTATUSLINE_WIDTH` |
| `~/.config/ccstatusline/` | `~/.config/cxstatusline/` | User configuration directory |
| `~/.config/ccstatusline/settings.json` | `~/.config/cxstatusline/settings.json` | Main settings file |
| `github.com/sirmalloc/ccstatusline` | `github.com/adrijshikhar/cxstatusline` | Repository URL |
| `Claude Code` | `OpenAI Codex` | User-facing documentation and CLI descriptions |

---

## 2. Environment Variables

When porting terminal width detection or configuration overrides, always support `CXSTATUSLINE_*` as the primary variable and maintain `CCSTATUSLINE_*` as a backward-compatible fallback:

```typescript
// Terminal width resolution example
const envWidth = process.env.CXSTATUSLINE_WIDTH ?? process.env.CCSTATUSLINE_WIDTH;
if (envWidth) {
  const parsed = parseInt(envWidth, 10);
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }
}
```

---

## 3. Telemetry & Session Data Mapping

Claude Code and OpenAI Codex CLI have different session telemetry mechanics:

- **Upstream (Claude Code)**:
  - Claude stores session transcripts and telemetry in JSON files on disk under `~/.claude/sessions/`.
  - Upstream reads session JSON files or Anthropic OAuth cache tokens directly.

- **cxstatusline (OpenAI Codex)**:
  - Codex telemetry is provided via stdin or pre-parsed runtime contexts, accessible in `RenderContext.data.session`.
  - Rate limits, token usage, and resets are accessed via typed session properties in `RenderContext`.

### Mapping Table

| Upstream Concept | cxstatusline Equivalent | Description |
|---|---|---|
| Claude session JSON on disk | `context.data?.session` | Session telemetry payload in `RenderContext` |
| Claude 5-hour rate limit | `session.rateLimits?.fiveHour` | Five-hour rolling window rate limit |
| Claude 7-day / weekly limit | `session.rateLimits?.weekly` | Seven-day weekly quota limit |
| Claude reset timestamp | `limit.resetsAt` (Date string / timestamp) | Rate limit reset time |
| Session duration | `session.durationMs` / calculated from start | Elapsed session time |

---

## 4. UI Keybind Conventions & Collision Avoidance

The `cxstatusline` items editor reserves specific global keybinds across all widget editors:
- `h`: Reserved for toggling the **Hideable States Checklist** (`USAGE_HIDEABLE_STATES`).
- `d`: Reserved for delete / remove item.
- `m`: Reserved for move item.
- `s`: Reserved for style / formatting.
- `g`: Standardized for **Glyph / Symbol Slot Editor** (`symbol-override.tsx`).

### Collision Resolution Rules

When upstream introduces an editor action that binds to `h` or other reserved keys, remap the keybind:

| Upstream Widget Action | Upstream Key | cxstatusline Remapped Key | Label / Modifier Text |
|---|---|---|---|
| Weekly Reset: Hours only | `h` | `o` | `'(o)nly hours'` (`key: 'o'`) |
| Time format: 12/24 hour | `h` | `f` | `'12/24 (f)ormat'` (`key: 'f'`) |
| Symbol slots editor | `g` | `g` | `'(g)lyphs'` (`key: 'g'`) |

---

## 5. Testing Framework Translation

Upstream uses Jest / Vitest idioms, whereas `cxstatusline` runs natively on **Bun** with `bun:test`.

### Import Translation

```typescript
// Upstream (Vitest / Jest)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// cxstatusline (Bun)
import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
```

### Mocking & Spying Patterns

| Upstream Idiom | `bun:test` Equivalent |
|---|---|
| `vi.fn()` / `jest.fn()` | `mock(() => ...)` |
| `vi.spyOn(obj, 'method')` | `spyOn(obj, 'method')` |
| `vi.mock('module', ...)` | `mock.module('module', () => ...)` |
| `vi.useFakeTimers()` | Standard JavaScript date mocking or parameter injection |
| `vi.advanceTimersByTime(ms)` | Parameterized time offsets |

---

## 6. Widget Definition & Symbol Slots Pattern

When porting widgets that support configurable symbols (e.g. `GitChanges`, `JJChanges`):

1. **Define Named Symbol Slots**:
   ```typescript
   export const GIT_CHANGES_SYMBOL_SLOTS = [
     { id: 'insertions', label: 'Insertions symbol', defaultSymbol: '+' },
     { id: 'deletions', label: 'Deletions symbol', defaultSymbol: '-' },
   ] as const;
   ```
2. **Retrieve Active Symbols via `getSlotSymbol`**:
   ```typescript
   import { getSlotSymbol } from './shared/symbol-override.js';

   const plusSymbol = getSlotSymbol(item, 'insertions', '+');
   const minusSymbol = getSlotSymbol(item, 'deletions', '-');
   ```
3. **Register Editor Action**:
   Expose keybind `g` with `renderEditor` linking to the symbol slot override UI.
