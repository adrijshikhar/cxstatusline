import { Box, Text } from "ink";
import React from "react";
import { List, type ListEntry } from "./List";

export type MainMenuOption = "lines" | "colors" | "powerline" | "overrides" | "export" | "import" | "save" | "discard";

export function buildMainMenuItems(): readonly (ListEntry<MainMenuOption> | "-")[] {
  return [
    { label: "Lines", value: "lines", description: "Edit up to three status-line rows and their widgets." },
    { label: "Colors", value: "colors", description: "Set widget foreground, background, bold, and dim styling." },
    { label: "Powerline", value: "powerline", description: "Toggle Powerline rendering and its existing themes." },
    { label: "Global Overrides", value: "overrides", description: "Set padding, separators, and global display overrides." },
    "-",
    { label: "Export", value: "export", description: "Write the current in-memory configuration to a JSON file." },
    { label: "Import", value: "import", description: "Preview and confirm a layout from a JSON file." },
    "-",
    { label: "Save & Exit", value: "save", description: "Atomically save the current configuration, then exit." },
    { label: "Exit Without Saving", value: "discard", description: "Discard this TUI session without writing settings.json." },
  ];
}

export interface MainMenuProps {
  onSelect: (value: MainMenuOption, index: number) => void;
  initialSelection?: number;
  hasChanges?: boolean;
}

export function MainMenu({ onSelect, initialSelection = 0, hasChanges = false }: MainMenuProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>Main Menu{hasChanges ? " (unsaved changes)" : ""}</Text>
      <List items={buildMainMenuItems()} marginTop={1} initialSelection={initialSelection} onSelect={(value, index) => {
        if (value !== "back") onSelect(value, index);
      }} />
    </Box>
  );
}
