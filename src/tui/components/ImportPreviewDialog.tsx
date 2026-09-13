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

/** Adapted from ccstatusline's import review, without merge or external widgets. */
export function ImportPreviewDialog({ preview, terminalWidth, busy = false, onConfirm, onCancel }: ImportPreviewDialogProps): React.JSX.Element {
  const rows = renderStatusLines(preview.settings, { ...PREVIEW_CONTEXT, isPreview: true, terminalWidth });
  const commands = preview.settings.lines.flat()
    .filter((item) => item.type === "custom-command")
    .map((item) => item.commandPath ?? "(no command)");
  return (
    <Box flexDirection="column">
      <Text bold>Import Preview</Text>
      <Text dimColor>Preview rendered by the production statusline renderer:</Text>
      <Box marginTop={1} flexDirection="column">{rows.map((row, index) => <Text key={index}>{row}</Text>)}</Box>
      {preview.omittedTypes.length > 0 && <Text color="yellow">{`Deferred unsupported widgets: ${preview.omittedTypes.join(", ")}`}</Text>}
      {commands.length > 0 && <Box flexDirection="column">
        <Text color="yellow">Commands that will run on every render:</Text>
        {commands.map((command, index) => <Text key={index} color="yellow">{`  ${command}`}</Text>)}
      </Box>}
      {busy ? <Text dimColor>Applying imported configuration…</Text> : <>
        <Text>Apply this preset?</Text>
        <ConfirmDialog inline onConfirm={onConfirm} onCancel={onCancel} />
      </>}
    </Box>
  );
}
