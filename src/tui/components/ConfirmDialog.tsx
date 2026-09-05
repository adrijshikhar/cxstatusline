import { Box, Text, useInput } from "ink";
import React from "react";
import { List, type ListEntry } from "./List";

export interface ConfirmDialogProps {
  message?: string;
  onConfirm: () => void;
  onCancel: () => void;
  inline?: boolean;
}

const OPTIONS: readonly ListEntry<boolean>[] = [
  { label: "Yes", value: true },
  { label: "No", value: false },
];

export function ConfirmDialog({ message, onConfirm, onCancel, inline = false }: ConfirmDialogProps): React.JSX.Element {
  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  const list = <List items={OPTIONS} color="cyan" onSelect={(confirmed) => confirmed ? onConfirm() : onCancel()} />;
  return inline ? list : (
    <Box flexDirection="column">
      {message && <Text>{message}</Text>}
      <Box marginTop={1}>{list}</Box>
    </Box>
  );
}
