import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type {
    WidgetEditorProps,
    WidgetItem
} from '../../types/Widget';
import { shouldInsertInput } from '../../utils/input-guards';

export interface NumericEditorOptions {
    field: 'maxWidth' | 'timeout';
    prompt: string;
    hint: string;
}

export function renderNumericEditor(
    props: WidgetEditorProps,
    options: NumericEditorOptions
): React.ReactElement {
    return <NumericEditor {...props} options={options} />;
}

const NumericEditor: React.FC<WidgetEditorProps & { options: NumericEditorOptions }> = ({
    widget,
    onComplete,
    onCancel,
    options
}) => {
    const { field, prompt, hint } = options;
    const initialValue = widget[field]?.toString() ?? '';
    const [value, setValue] = useState(initialValue);

    useInput((input, key) => {
        if (key.return) {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
                onComplete({ ...widget, [field]: num });
            } else {
                const rest: WidgetItem = { ...widget };
                delete rest[field];
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
                <Text>{prompt}</Text>
                <Text>{value}</Text>
                <Text backgroundColor='gray' color='black'>{' '}</Text>
            </Box>
            <Text dimColor>{hint}</Text>
        </Box>
    );
};
