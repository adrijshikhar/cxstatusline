import { Box, useStdout } from "ink";
import { useEffect, useState } from "react";
import React from "react";
import type { Settings } from "../../src/types/Settings";
import { StatusLinePreview } from "../../src/tui/components/StatusLinePreview";

export function PreviewFooter({ settings }: { settings: Settings }): React.JSX.Element {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout.columns || 80);
  useEffect(() => {
    const onResize = () => setColumns(stdout.columns || 80);
    stdout.on("resize", onResize);
    return () => stdout.off("resize", onResize);
  }, [stdout]);
  return <Box flexDirection="column"><StatusLinePreview settings={{ ...settings, flexMode: "full" }} terminalWidth={columns} /></Box>;
}
