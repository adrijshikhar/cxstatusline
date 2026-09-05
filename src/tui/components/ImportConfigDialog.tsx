import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export interface ImportConfigDialogProps {
  error?: string | null;
  onFileChosen: (filePath: string) => void;
  onCancel: () => void;
}

function acceptsText(input: string, key: { ctrl: boolean; meta: boolean; tab: boolean }): boolean {
  return Boolean(input && !key.ctrl && !key.meta && !key.tab);
}

/** Adapted from ccstatusline's import path dialog. */
export function ImportConfigDialog({ error, onFileChosen, onCancel }: ImportConfigDialogProps): React.JSX.Element {
  const [path, setPath] = useState("");
  useInput((input, key) => {
    if (key.return) onFileChosen(path);
    else if (key.escape) onCancel();
    else if (key.backspace || key.delete) setPath((current) => current.slice(0, -1));
    else if (acceptsText(input, key)) setPath((current) => current + input);
  });
  return (
    <Box flexDirection="column">
      <Text bold>Import Config</Text>
      <Text dimColor>Enter the file path to import configuration from:</Text>
      <Text>{`Path: ${path}`}<Text inverse> </Text></Text>
      {error && <Text color="red">{error}</Text>}
      <Text dimColor>Enter to preview, Escape to cancel</Text>
    </Box>
  );
}
