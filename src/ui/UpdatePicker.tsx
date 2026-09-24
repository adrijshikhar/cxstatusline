import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { List, type ListEntry } from "../tui/components/List";
import { prompt } from "./prompt";
import { useTerminalSize } from "./terminal-size";

export type UpdateAction = "prebuilt" | "compile" | "stock" | "cancel";
export interface UpdatePickerOptions {
  readonly latest: string;
  readonly highestAvailable?: string;
}

export function UpdatePicker({ latest, highestAvailable, onSelect }: UpdatePickerOptions & {
  onSelect: (action: UpdateAction) => void;
}): React.JSX.Element {
  const { usable, maxVisibleItems } = useTerminalSize();
  const [selectedIndex, setSelectedIndex] = useState(highestAvailable ? 0 : 2);
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) onSelect("cancel");
  });
  if (!usable) return <Box flexDirection="column" marginY={1}>
    <Text>Resize terminal to at least 40 columns × 20 rows to continue.</Text>
    <Text dimColor>Esc/Ctrl+C cancel</Text>
  </Box>;
  const items: ListEntry<UpdateAction>[] = [];
  if (highestAvailable) items.push({
    label: `Install prebuilt Codex ${highestAvailable}`,
    sublabel: "· recommended",
    value: "prebuilt",
    description: "Downloads a verified prebuilt. No Rust toolchain needed.",
  });
  items.push(
    { label: `Compile Codex ${latest} from source`, value: "compile",
      description: "Requires Rust, at least 20 GiB free, and may take tens of minutes." },
    { label: `Update to stock Codex ${latest} anyway`, value: "stock",
      description: "Updates upstream without a matching published statusline prebuilt." },
    { label: "Cancel", value: "cancel" },
  );
  return <Box flexDirection="column" marginY={1}>
    <Text bold>How would you like to proceed?</Text>
    <List items={items} marginTop={1} maxVisibleItems={maxVisibleItems} initialSelection={selectedIndex}
      onSelectionChange={(_, index) => setSelectedIndex(index)}
      onSelect={(value) => { if (value !== "back") onSelect(value); }} />
    <Box marginTop={1}><Text dimColor>↑/↓ navigate · Enter select · Esc/Ctrl+C cancel</Text></Box>
  </Box>;
}

export function promptUpdate(options: UpdatePickerOptions): Promise<UpdateAction> {
  return prompt((onSelect) => <UpdatePicker {...options} onSelect={onSelect} />, "cancel" as UpdateAction);
}
