import * as fs from 'node:fs';
import * as path from 'node:path';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
  CustomKeybind,
  HideableState,
  Widget,
  WidgetEditorDisplay,
  WidgetEditorProps,
  WidgetItem,
} from '../types/Widget';
import { getGitShortSha, resolveGitCwd, runGit } from '../utils/git';
import { isInsideJjRepo } from '../utils/jj';
import { makeModifierText } from './shared/editor-display';
import { isHideStateEnabled, NO_GIT_HIDEABLE_STATE } from './shared/hideable';
import {
  MAX_WIDTH_ACTION,
  applyMaxWidth,
  getMaxWidthKeybind,
  getMaxWidthModifier,
  renderMaxWidthEditor,
} from './shared/max-width';
import {
  formatSymbolPrefix,
  getSymbolKeybind,
  renderSymbolOverrideEditor,
} from './shared/symbol-override';

const DEFAULT_SYMBOL = '⎇';
const BRANCH_REF_PREFIX = 'refs/heads/';

export class GitBranchWidget implements Widget {
  getDefaultColor(): string { return 'magenta'; }
  getDescription(): string { return 'Shows the current git branch name'; }
  getDisplayName(): string { return 'Git Branch'; }
  getCategory(): string { return 'Git'; }
  getHideableStates(): HideableState[] { return [NO_GIT_HIDEABLE_STATE]; }

  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const modifiers: string[] = [];
    if (item.metadata?.fishStyle === 'true') {
      modifiers.push('fish-style');
    }
    const maxWidthText = getMaxWidthModifier(item);
    if (maxWidthText) modifiers.push(maxWidthText);
    return { displayText: this.getDisplayName(), modifierText: makeModifierText(modifiers) };
  }

  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
    if (action === 'toggle-fish-style') {
      const enabled = item.metadata?.fishStyle === 'true';
      const { fishStyle, ...restMetadata } = item.metadata ?? {};
      const nextMetadata = enabled ? restMetadata : { ...restMetadata, fishStyle: 'true' };
      return {
        ...item,
        metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
      };
    }
    return null;
  }

  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const prefix = formatSymbolPrefix(item, DEFAULT_SYMBOL);
    const fishStyle = item.metadata?.fishStyle === 'true';

    if (context.isPreview) {
      const sample = item.maxWidth ? 'feature/long-branch-name' : 'main';
      const display = this.abbreviateBranch(sample, fishStyle);
      return applyMaxWidth(item.rawValue ? display : prefix + display, item.maxWidth);
    }

    const cwd = resolveGitCwd(context);
    const payloadBranch = context.data.git?.branch;
    const branch = payloadBranch ?? (cwd ? this.getGitBranch(context) : null);

    // A detached HEAD (rebase, bisect, tag checkout) has no branch, so
    // show its commit in parentheses, as git prompts do. jj keeps git's
    // HEAD detached in a colocated repo, on a commit the user never
    // checked out, so there it's no branch at all.
    const ref = branch ?? (cwd ? (this.isColocatedJjRepo(context) ? null : getGitShortSha(context)) : null);
    if (!ref) {
      return isHideStateEnabled(item, NO_GIT_HIDEABLE_STATE) ? null : `${prefix}no git`;
    }

    // A detached HEAD renders as "(sha)" and must not be fish-abbreviated
    const value = branch ?? `(${ref})`;
    const displayValue = branch === null || branch === undefined ? value : this.abbreviateBranch(value, fishStyle);
    return applyMaxWidth(item.rawValue ? displayValue : `${prefix}${displayValue}`, item.maxWidth);
  }

  private getGitBranch(context: RenderContext): string | null {
    const ref = runGit('symbolic-ref HEAD', context);
    return ref?.startsWith(BRANCH_REF_PREFIX) ? ref.slice(BRANCH_REF_PREFIX.length) : ref;
  }

  // Fish-style branch abbreviation: every segment but the last collapses to
  // its first character, so 'main' -> 'm' and 'fix/np/story' -> 'f/p/story'.
  private abbreviateBranch(branch: string, fishStyle: boolean): string {
    if (!fishStyle) {
      return branch;
    }
    const parts = branch.split('/');
    if (parts.length === 1) {
      return Array.from(branch)[0] ?? '';
    }
    return parts.map((part, index) => (index === parts.length - 1 ? part : Array.from(part)[0] ?? '')).join('/');
  }

  // jj finds its workspace from the nearest .jj above, past a git repo's own
  // root, so `jj root` also succeeds in a plain git repo anywhere under a jj
  // workspace. The repo is colocated only when its work tree holds the .jj.
  private isColocatedJjRepo(context: RenderContext): boolean {
    if (!isInsideJjRepo(context)) {
      return false;
    }

    const topLevel = runGit('rev-parse --show-toplevel', context);
    if (!topLevel) {
      return false;
    }

    try {
      return fs.statSync(path.join(topLevel, '.jj')).isDirectory();
    } catch {
      return false;
    }
  }

  getCustomKeybinds(): CustomKeybind[] {
    return [
      { key: 'f', label: '(f)ish style', action: 'toggle-fish-style' },
      getMaxWidthKeybind(),
      getSymbolKeybind(),
    ];
  }

  renderEditor(props: WidgetEditorProps) {
    return props.action === MAX_WIDTH_ACTION
      ? renderMaxWidthEditor(props)
      : renderSymbolOverrideEditor(props, DEFAULT_SYMBOL);
  }

  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}
