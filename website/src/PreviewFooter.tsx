import { Box, useStdout } from "ink";
import { useEffect, useState } from "react";
import React from "react";
import type { Settings } from "../../src/types/Settings";
import { StatusLinePreview } from "../../src/tui/components/StatusLinePreview";

export function PreviewFooter({ settings }: { settings: Settings }): React.JSX.Element {
  const { stdout } = useStdout();
  const writeStream = stdout as NodeJS.WriteStream;
  const [columns, setColumns] = useState(writeStream.columns || 80);
  useEffect(() => {
    const onResize = () => setColumns(writeStream.columns || 80);
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout, writeStream]);
  return <Box flexDirection="column"><StatusLinePreview settings={{ ...settings, flexMode: "full" }} terminalWidth={columns} /></Box>;
}
