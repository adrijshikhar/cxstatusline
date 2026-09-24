import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { List } from "../tui/components/List";
import { useTerminalSize } from "./terminal-size";
import type { PromptVersionOptions, PromptVersionSelection } from "./prompt-version";

interface VersionPickerProps extends PromptVersionOptions {
  onSelect: (selection: PromptVersionSelection | null) => void;
}

export function VersionPicker({ supportedVersions, prebuiltVersions, defaultVersion, compile = false, onSelect }: VersionPickerProps): React.JSX.Element {
  const { usable, maxVisibleItems } = useTerminalSize();
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, supportedVersions.indexOf(defaultVersion ?? "")));
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);

  useInput((input, key) => {
    if (!usable) {
      if (key.escape || (key.ctrl && input === "c")) onSelect(null);
      return;
    }
    if (key.ctrl && input === "c") onSelect(null);
    else if (key.escape) {
      if (sourceVersion) setSourceVersion(null);
      else onSelect(null);
    }
  });

  if (!usable) return <Box flexDirection="column" marginY={1}>
    <Text>Resize terminal to at least 40 columns × 20 rows to continue.</Text>
    <Text dimColor>Esc/Ctrl+C cancel</Text>
  </Box>;

  if (sourceVersion) {
    return <Box flexDirection="column" marginY={1}>
      <Text bold>Build Codex {sourceVersion} from source?</Text>
      <Text>No prebuilt is published for this version.</Text>
      <Text dimColor>Requires Rust, at least 20 GiB free, and may take tens of minutes.</Text>
      <List
        key="confirm"
        marginTop={1}
        maxVisibleItems={maxVisibleItems}
        items={[
          { label: "Back to versions", value: "back" },
          { label: "Compile from source", value: "compile" },
        ]}
        onSelect={(value) => value === "compile"
          ? onSelect({ version: sourceVersion, compile: true })
          : setSourceVersion(null)}
      />
      <Box marginTop={1}><Text dimColor>↑/↓ navigate · Enter select · Esc back · Ctrl+C cancel</Text></Box>
    </Box>;
  }

  return <Box flexDirection="column" marginY={1}>
    <Text bold>Select Codex version to install</Text>
      <List
        key="versions"
        marginTop={1}
        maxVisibleItems={maxVisibleItems}
        initialSelection={selectedIndex}
        onSelectionChange={(_, index) => setSelectedIndex(index)}
      items={supportedVersions.map((version) => {
        const source = compile || Boolean(prebuiltVersions && !prebuiltVersions.includes(version));
        return {
          value: version,
          label: version,
          sublabel: `${source ? "build from source" : "prebuilt"}${version === defaultVersion ? " · default" : ""}`,
          description: source
            ? "Builds locally with Rust. Requires at least 20 GiB free."
            : "Downloads a verified prebuilt. No Rust toolchain needed.",
        };
      })}
      onSelect={(version, index) => {
        if (version === "back") return;
        setSelectedIndex(index);
        if (!compile && prebuiltVersions && !prebuiltVersions.includes(version)) setSourceVersion(version);
        else onSelect({ version, compile });
      }}
    />
    <Box marginTop={1}><Text dimColor>↑/↓ navigate · Enter select · Esc/Ctrl+C cancel</Text></Box>
  </Box>;
}
