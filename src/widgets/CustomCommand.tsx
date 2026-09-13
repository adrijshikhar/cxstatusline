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
    describeFailure,
    refundBudget,
    resolveTimeout,
    spawnCommand,
    takeBudget,
    type CommandRunner
} from './shared/command-runner';
import { makeModifierText } from './shared/editor-display';
import {
    MAX_WIDTH_ACTION,
    applyMaxWidth,
    getMaxWidthKeybind,
    getMaxWidthModifier,
    renderMaxWidthEditor
} from './shared/max-width';

const EDIT_COMMAND_ACTION = 'edit-command';
const EDIT_TIMEOUT_ACTION = 'edit-timeout';
const TOGGLE_PRESERVE_ACTION = 'toggle-preserve';
const PREVIEW_COMMAND_CHARS = 20;

/** First visibly non-empty line of stdout, trimmed. Codex rejects frames with blank or extra rows. */
export function firstLine(stdout: string): string {
    return stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => getVisibleText(line).trim().length > 0) ?? '';
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
        const truncatedCmd = cmd.length > PREVIEW_COMMAND_CHARS ? `${cmd.substring(0, 17)}...` : cmd;
        const modifiers: string[] = [];
        const maxWidth = getMaxWidthModifier(item);
        if (maxWidth) {
            modifiers.push(maxWidth);
        }
        if (item.timeout !== undefined && item.timeout !== DEFAULT_TIMEOUT_MS) {
            modifiers.push(`timeout:${resolveTimeout(item)}ms`);
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
        if (context.isPreview) {
            if (!item.commandPath) {
                return '[No command]';
            }
            const shown = item.commandPath.substring(0, PREVIEW_COMMAND_CHARS);
            return `[cmd: ${shown}${item.commandPath.length > PREVIEW_COMMAND_CHARS ? '...' : ''}]`;
        }
        if (!item.commandPath) {
            return null;
        }

        const timeoutMs = takeBudget(context, resolveTimeout(item));
        if (timeoutMs === 0) {
            return '[Budget]';
        }

        const input = JSON.stringify(typeof context.terminalWidth === 'number'
            ? { ...context.data, terminal_width: context.terminalWidth }
            : context.data);
        const cwd = context.data.session?.cwd;
        const start = performance.now();
        const result = this.runner({
            command: item.commandPath,
            input,
            timeoutMs,
            cwd: cwd && cwd.length > 0 ? cwd : undefined
        });
        const elapsed = performance.now() - start;
        refundBudget(context, timeoutMs - elapsed);

        const failure = describeFailure(result);
        if (failure) {
            return failure;
        }

        const line = firstLine(result.stdout);
        const cleaned = item.preserveColors ? keepSgrOnly(line) : keepSgrOnly(getVisibleText(line));
        const text = applyMaxWidth(cleaned, item.maxWidth);
        return getVisibleText(text).trim().length > 0 ? text : null;
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'e', label: '(e)dit cmd', action: EDIT_COMMAND_ACTION },
            getMaxWidthKeybind(),
            { key: 't', label: '(t)imeout', action: EDIT_TIMEOUT_ACTION },
            { key: 'p', label: '(p)reserve colors', action: TOGGLE_PRESERVE_ACTION }
        ];
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement {
        if (props.action === MAX_WIDTH_ACTION) {
            return renderMaxWidthEditor(props);
        }
        if (props.action === EDIT_TIMEOUT_ACTION) {
            return <TimeoutEditor {...props} />;
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

const TimeoutEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel }) => {
    const [value, setValue] = useState(widget.timeout?.toString() ?? '');

    useInput((input, key) => {
        if (key.return) {
            const timeout = parseInt(value, 10);
            if (!isNaN(timeout) && timeout > 0) {
                onComplete({ ...widget, timeout });
            } else {
                const { timeout: removed, ...rest } = widget;
                void removed;
                onComplete(rest);
            }
        } else if (key.escape) {
            onCancel();
        } else if (key.backspace) {
            setValue(value.slice(0, -1));
        } else if (shouldInsertInput(input, key) && /\d/.test(input)) {
            setValue(value + input);
        }
    });

    return (
        <Box flexDirection='column'>
            <Box>
                <Text>{`Enter timeout in ms (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}, default ${DEFAULT_TIMEOUT_MS}, blank for default): `}</Text>
                <Text>{value}</Text>
                <Text backgroundColor='gray' color='black'>{' '}</Text>
            </Box>
            <Text dimColor>Values outside the range are clamped. Press Enter to save, ESC to cancel</Text>
        </Box>
    );
};
