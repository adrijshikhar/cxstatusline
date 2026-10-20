import { Box, Text } from "ink";
import React from "react";
import type { ImportPreview } from "../../utils/presets";
import { renderStatusLines } from "../../utils/renderer";
import { ConfirmDialog } from "./ConfirmDialog";
import { PREVIEW_CONTEXT } from "./StatusLinePreview";

export interface ImportPreviewDialogProps {
  preview: ImportPreview;
  terminalWidth: number;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Control characters as `\uXXXX`: an imported file's text is shown, never sent
 * to the terminal as escape sequences, and hidden characters stay visible.
 */
export function escapeControlCharacters(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Adapted from ccstatusline's import review, without merge or external widgets. */
export function ImportPreviewDialog({ preview, terminalWidth, busy = false, onConfirm, onCancel }: ImportPreviewDialogProps): React.JSX.Element {
  const rows = renderStatusLines(preview.settings, { ...PREVIEW_CONTEXT, isPreview: true, terminalWidth });
  const allCustomCommands = preview.settings.lines.flat()
    .filter((item) => item.type === "custom-command");
  const uncachedCommands = allCustomCommands
    .filter((item) => item.refreshMs === undefined)
    .map((item) => escapeControlCharacters(item.commandPath ?? "(no command)"));
  const cachedCommands = allCustomCommands
    .filter((item) => item.refreshMs !== undefined)
    .map((item) => `${escapeControlCharacters(item.commandPath ?? "(no command)")} (every ${item.refreshMs}ms)`);
  return (
    <Box flexDirection="column">
      <Text bold>Import Preview</Text>
      <Text dimColor>Preview rendered by the production statusline renderer:</Text>
      <Box marginTop={1} flexDirection="column">{rows.map((row, index) => <Text key={index}>{row}</Text>)}</Box>
      {preview.omittedTypes.length > 0 && <Text color="yellow">{`Deferred unsupported widgets: ${preview.omittedTypes.join(", ")}`}</Text>}
      {uncachedCommands.length > 0 && <Box flexDirection="column">
        <Text color="yellow">Commands that will run on every render:</Text>
        {uncachedCommands.map((command, index) => <Text key={index} color="yellow">{`  ${command}`}</Text>)}
      </Box>}
      {cachedCommands.length > 0 && <Box flexDirection="column">
        <Text color="yellow">Cached commands (run in background):</Text>
        {cachedCommands.map((command, index) => <Text key={index} color="yellow">{`  ${command}`}</Text>)}
      </Box>}
      {busy ? <Text dimColor>Applying imported configuration…</Text> : <>
        <Text>Apply this preset?</Text>
        <ConfirmDialog inline onConfirm={onConfirm} onCancel={onCancel} />
      </>}
    </Box>
  );
}
