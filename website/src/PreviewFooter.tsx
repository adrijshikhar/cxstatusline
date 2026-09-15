import { Box, useStdout } from "ink";
import React from "react";
import type { Settings } from "../../src/types/Settings";
import { StatusLinePreview } from "../../src/tui/components/StatusLinePreview";

export function PreviewFooter({ settings }: { settings: Settings }): React.JSX.Element {
  const { stdout } = useStdout();
  return <Box flexDirection="column"><StatusLinePreview settings={{ ...settings, flexMode: "full" }} terminalWidth={stdout.columns || 80} /></Box>;
}
