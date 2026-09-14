import { Box, useStdout } from "ink";
import React, { useEffect, useState } from "react";
import type { Settings } from "../../src/types/Settings";
import { StatusLinePreview } from "../../src/tui/components/StatusLinePreview";

export function PreviewFooter({ settings }: { settings: Settings }): React.JSX.Element {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(() => stdout.columns || 80);
  useEffect(() => {
    const update = (): void => setWidth(stdout.columns || 80);
    stdout.on("resize", update);
    return () => { stdout.off("resize", update); };
  }, [stdout]);
  return <Box flexDirection="column"><StatusLinePreview settings={settings} terminalWidth={width} /></Box>;
}
