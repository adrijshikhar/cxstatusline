import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type { RenderContext } from '../../types/RenderContext';
import type {
    CustomKeybind,
    WidgetEditorDisplay,
    WidgetEditorProps,
    WidgetItem
} from '../../types/Widget';
import { shouldInsertInput } from '../../utils/input-guards';

import { makeModifierText } from './editor-display';
import { formatRawOrLabeledValue } from './raw-or-labeled';

export type SpeedWidgetKind = 'input' | 'output' | 'total';

interface SpeedWidgetKindConfig {
    label: string;
    displayName: string;
    description: string;
    sessionPreview: string;
    windowedPreview: string;
}

const SPEED_WIDGET_CONFIG: Record<SpeedWidgetKind, SpeedWidgetKindConfig> = {
    input: {
        label: 'In: ',
        displayName: 'Input Speed',
        description: 'Shows session-average input token speed (tokens/sec).',
        sessionPreview: '85.2 t/s',
        windowedPreview: '31.5 t/s'
    },
    output: {
        label: 'Out: ',
        displayName: 'Output Speed',
        description: 'Shows session-average output token speed (tokens/sec).',
        sessionPreview: '42.5 t/s',
        windowedPreview: '26.8 t/s'
    },
    total: {
        label: 'Total: ',
        displayName: 'Total Speed',
        description: 'Shows session-average total token speed (tokens/sec).',
        sessionPreview: '127.7 t/s',
        windowedPreview: '58.3 t/s'
    }
};

function calculateSpeed(kind: SpeedWidgetKind, context: RenderContext): number | null {
    const startedAt = context.data.session?.started_at;
    if (!startedAt) return null;
    const elapsedSeconds = (context.now.getTime() - new Date(startedAt).getTime()) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
    const usage = context.data.usage;
    const tokens = kind === 'input' ? usage?.input_tokens
        : kind === 'output' ? usage?.output_tokens
        : usage?.input_tokens === undefined && usage?.output_tokens === undefined
            ? undefined
            : (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
    return tokens === undefined ? null : tokens / elapsedSeconds;
}

function formatSpeed(speed: number | null): string | null {
    return speed === null ? null : `${speed.toFixed(1)} t/s`;
}

export function getSpeedWidgetDisplayName(kind: SpeedWidgetKind): string {
    return SPEED_WIDGET_CONFIG[kind].displayName;
}

export function getSpeedWidgetDescription(kind: SpeedWidgetKind): string {
    return SPEED_WIDGET_CONFIG[kind].description;
}

export function getSpeedWidgetEditorDisplay(kind: SpeedWidgetKind, item: WidgetItem): WidgetEditorDisplay {
    void item;
    return {
        displayText: getSpeedWidgetDisplayName(kind),
        modifierText: makeModifierText(['session avg'])
    };
}

export function renderSpeedWidgetValue(
    kind: SpeedWidgetKind,
    item: WidgetItem,
    context: RenderContext
): string | null {
    const config = SPEED_WIDGET_CONFIG[kind];
    const previewValue = config.sessionPreview;

    if (context.isPreview) {
        return formatRawOrLabeledValue(item, config.label, previewValue);
    }

    const speed = calculateSpeed(kind, context);
    if (speed === null) {
        return null;
    }
    return formatRawOrLabeledValue(item, config.label, formatSpeed(speed));
}

export function getSpeedWidgetCustomKeybinds(): CustomKeybind[] {
    return [];
}

export function renderSpeedWidgetEditor(_props: WidgetEditorProps): React.ReactElement | null {
    return null;
}
