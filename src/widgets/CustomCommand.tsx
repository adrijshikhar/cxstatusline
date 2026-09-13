import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetEditorProps,
    WidgetItem
} from '../types/Widget';
import { getVisibleText, keepSgrOnly } from '../utils/ansi';
import { shouldInsertInput } from '../utils/input-guards';

import {
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    resolveTimeout,
    spawnCommand,
    type CommandRunner
} from './shared/command-runner';
import {
    MIN_REFRESH_MS,
    MAX_REFRESH_MS,
    resolveCommandText
} from './shared/cached-command';
import { makeModifierText } from './shared/editor-display';
import {
    MAX_WIDTH_ACTION,
    getMaxWidthKeybind,
    getMaxWidthModifier,
    renderMaxWidthEditor
} from './shared/max-width';
import { renderNumericEditor } from './shared/numeric-editor';

const EDIT_COMMAND_ACTION = 'edit-command';
const EDIT_TIMEOUT_ACTION = 'edit-timeout';
const EDIT_REFRESH_ACTION = 'edit-refresh';
const TOGGLE_PRESERVE_ACTION = 'toggle-preserve';
const PREVIEW_COMMAND_CHARS = 20;

export function truncateCommand(cmd: string): string {
    return cmd.length > PREVIEW_COMMAND_CHARS ? `${cmd.substring(0, PREVIEW_COMMAND_CHARS - 3)}...` : cmd;
}

export function previewText(item: WidgetItem): string {
    if (!item.commandPath) {
        return '[No command]';
    }
    const shown = item.commandPath.substring(0, PREVIEW_COMMAND_CHARS);
    return `[cmd: ${shown}${item.commandPath.length > PREVIEW_COMMAND_CHARS ? '...' : ''}]`;
}

// Adapted from ccstatusline's CustomCommand: same fields, keys, preview and diagnostic tokens.
// Departures for the Codex host: injectable runner, clamped timeout with a shared per-render
// budget, first-line-only output, and SGR-only colour preservation.
export class CustomCommandWidget implements Widget {
    constructor(private readonly runner: CommandRunner = spawnCommand) {}

    getDefaultColor(): string { return 'white'; }
    getDescription(): string { return 'Executes a custom shell command and displays output'; }
    getDisplayName(): string { return 'Custom Command'; }
    getCategory(): string { return 'Custom'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const cmd = item.commandPath ?? 'No command';
        const truncatedCmd = truncateCommand(cmd);
        const modifiers: string[] = [];
        const maxWidth = getMaxWidthModifier(item);
        if (maxWidth) {
            modifiers.push(maxWidth);
        }
        if (item.timeout !== undefined && item.timeout !== DEFAULT_TIMEOUT_MS) {
            modifiers.push(`timeout:${resolveTimeout(item)}ms`);
        }
        if (item.refreshMs !== undefined) {
            modifiers.push(`refresh: ${item.refreshMs}ms`);
        }
        if (item.preserveColors) {
            modifiers.push('preserve');
        }
        return { displayText: `${this.getDisplayName()} (${truncatedCmd})`, modifierText: makeModifierText(modifiers) };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === TOGGLE_PRESERVE_ACTION) {
            return { ...item, preserveColors: !item.preserveColors };
        }
        return null;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) return previewText(item);
        if (!item.commandPath) return null;
        return resolveCommandText(item, context, this.runner);
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'e', label: '(e)dit cmd', action: EDIT_COMMAND_ACTION },
            getMaxWidthKeybind(),
            { key: 't', label: '(t)imeout', action: EDIT_TIMEOUT_ACTION },
            { key: 'f', label: 're(f)resh', action: EDIT_REFRESH_ACTION },
            { key: 'p', label: '(p)reserve colors', action: TOGGLE_PRESERVE_ACTION }
        ];
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement {
        if (props.action === MAX_WIDTH_ACTION) {
            return renderMaxWidthEditor(props);
        }
        if (props.action === EDIT_TIMEOUT_ACTION) {
            return renderNumericEditor(props, {
                field: 'timeout',
                prompt: `Enter timeout in ms (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}, default ${DEFAULT_TIMEOUT_MS}, blank for default): `,
                hint: 'Values outside the range are clamped. Press Enter to save, ESC to cancel'
            });
        }
        if (props.action === EDIT_REFRESH_ACTION) {
            return renderNumericEditor(props, {
                field: 'refreshMs',
                prompt: `Enter refresh interval in ms (${MIN_REFRESH_MS}-${MAX_REFRESH_MS}, blank for uncached): `,
                hint: 'Output is shared by every session in the same directory. Press Enter to save, ESC to cancel'
            });
        }
        return <CommandEditor {...props} />;
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(item: WidgetItem): boolean { return !item.preserveColors; }
    emitsStyledOutput(item: WidgetItem): boolean { return item.preserveColors === true; }
}

const CommandEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel }) => {
    const [command, setCommand] = useState(widget.commandPath ?? '');
    const [cursor, setCursor] = useState(command.length);

    useInput((input, key) => {
        if (key.return) {
            if (command.trim().length === 0) {
                const { commandPath, ...rest } = widget;
                void commandPath;
                onComplete(rest);
            } else {
                onComplete({ ...widget, commandPath: command });
            }
        } else if (key.escape) {
            onCancel();
        } else if (key.leftArrow) {
            setCursor(Math.max(0, cursor - 1));
        } else if (key.rightArrow) {
            setCursor(Math.min(command.length, cursor + 1));
        } else if (key.backspace) {
            if (cursor > 0) {
                setCommand(command.slice(0, cursor - 1) + command.slice(cursor));
                setCursor(cursor - 1);
            }
        } else if (key.delete) {
            if (cursor < command.length) {
                setCommand(command.slice(0, cursor) + command.slice(cursor + 1));
            }
        } else if (shouldInsertInput(input, key)) {
            setCommand(command.slice(0, cursor) + input + command.slice(cursor));
            setCursor(cursor + input.length);
        }
    });

    return (
        <Box flexDirection='column'>
            <Text>
                Enter command:
                {' '}
                {command.slice(0, cursor)}
                <Text backgroundColor='gray' color='black'>{command[cursor] ?? ' '}</Text>
                {command.slice(cursor + 1)}
            </Text>
            <Text dimColor>Runs in your shell on every redraw. ←→ move cursor, Enter save, ESC cancel</Text>
        </Box>
    );
};
