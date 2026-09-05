import { Box, Text } from "ink";
import React from "react";
import type { RenderContext } from "../../types/RenderContext";
import type { Settings } from "../../types/Settings";
import { renderStatusLine, renderStatusLines } from "../../utils/renderer";

export interface StatusLinePreviewProps {
  settings: Settings;
  terminalWidth: number;
}

export const PREVIEW_CONTEXT: Omit<RenderContext, "isPreview" | "terminalWidth"> = {
  data: { payload_version: 1 },
  now: new Date(0),
  freeMemoryBytes: 0,
};

export function StatusLinePreview({ settings, terminalWidth }: StatusLinePreviewProps): React.JSX.Element {
  const rows = renderStatusLines(settings, { ...PREVIEW_CONTEXT, isPreview: true, terminalWidth });
  return <Box flexDirection="column">{rows.map((row, i) => <Text key={i}>{row}</Text>)}</Box>;
}
