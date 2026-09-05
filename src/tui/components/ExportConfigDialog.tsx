import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export interface ExportConfigDialogProps {
  initialPath: string;
  onExport: (filePath: string) => void;
  onCancel: () => void;
}

function acceptsText(input: string, key: { ctrl: boolean; meta: boolean; tab: boolean }): boolean {
  return Boolean(input && !key.ctrl && !key.meta && !key.tab);
}

/** Adapted from ccstatusline's export path dialog. */
export function ExportConfigDialog({ initialPath, onExport, onCancel }: ExportConfigDialogProps): React.JSX.Element {
  const [path, setPath] = useState(initialPath);
  useInput((input, key) => {
    if (key.return) onExport(path);
    else if (key.escape) onCancel();
    else if (key.backspace || key.delete) setPath((current) => current.slice(0, -1));
    else if (acceptsText(input, key)) setPath((current) => current + input);
  });
  return (
    <Box flexDirection="column">
      <Text bold>Export Config</Text>
      <Text dimColor>Enter the file path to export your configuration to:</Text>
      <Text>{`Path: ${path}`}<Text inverse> </Text></Text>
      <Text dimColor>Enter to confirm, Escape to cancel</Text>
    </Box>
  );
}
