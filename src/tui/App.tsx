import { readFile, writeFile } from "node:fs/promises";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../types/Settings";
import type { WidgetItem } from "../types/Widget";
import { loadSettings, saveSettings } from "../utils/config";
import { exportPreset, previewImport, type ImportPreview } from "../utils/presets";
import { ColorMenu } from "./components/ColorMenu";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ExportConfigDialog } from "./components/ExportConfigDialog";
import { GlobalOverridesMenu } from "./components/GlobalOverridesMenu";
import { ImportConfigDialog } from "./components/ImportConfigDialog";
import { ImportPreviewDialog } from "./components/ImportPreviewDialog";
import { ItemsEditor } from "./components/ItemsEditor";
import { LineSelector } from "./components/LineSelector";
import { MainMenu, type MainMenuOption } from "./components/MainMenu";
import { PowerlineSetup } from "./components/PowerlineSetup";
import { StatusLinePreview } from "./components/StatusLinePreview";

export type AppScreen = "main"
  | "lines"
  | "items"
  | "colors"
  | "powerline"
  | "overrides"
  | "export"
  | "import"
  | "import-preview"
  | "confirm-save"
  | "confirm-discard"
  | "confirm-invalid-replace";

export interface AppProps {
  /** Supplying settings is useful for embedding and keeps tests off disk. */
  initialSettings?: Settings;
  settingsPath: string;
  readImportFile?: (file: string) => Promise<string>;
  writeSettings?: typeof saveSettings;
}

const readImportFileFromDisk = (file: string): Promise<string> => readFile(file, "utf8");

/** Never hand mutable settings references across the TUI boundary. */
export function cloneSettings(settings: Settings): Settings {
  const clone = globalThis.structuredClone;
  return typeof clone === "function" ? clone(settings) : JSON.parse(JSON.stringify(settings)) as Settings;
}

function clampSettings(settings: Settings): Settings {
  const cloned = cloneSettings(settings);
  const lines = cloned.lines.slice(0, 3);
  return { ...cloned, lines: lines.length ? lines : [[]] };
}

export function App({ initialSettings, settingsPath, readImportFile = readImportFileFromDisk, writeSettings = saveSettings }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [settings, setSettings] = useState<Settings | null>(() => initialSettings ? clampSettings(initialSettings) : null);
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(() => initialSettings ? clampSettings(initialSettings) : null);
  const [editSnapshot, setEditSnapshot] = useState<Settings | null>(null);
  const [screen, setScreen] = useState<AppScreen>("main");
  const [selectedLine, setSelectedLine] = useState(0);
  const [colorLine, setColorLine] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [terminalWidth, setTerminalWidth] = useState(() => stdout.columns || 80);
  const importGeneration = useRef(0);
  const importApplyPending = useRef(false);

  useEffect(() => {
    const updateWidth = (): void => setTerminalWidth(stdout.columns || 80);
    stdout.on("resize", updateWidth);
    return () => { stdout.off("resize", updateWidth); };
  }, [stdout]);

  useEffect(() => {
    if (initialSettings) return;
    let active = true;
    void loadSettings(settingsPath).then((loaded) => {
      if (!active) return;
      const next = clampSettings(loaded.settings);
      setSettings(next);
      setOriginalSettings(cloneSettings(next));
      if (loaded.error) {
        setScreen("confirm-invalid-replace");
      }
    }).catch(() => {
      if (!active) return;
      const next = clampSettings(DEFAULT_SETTINGS);
      setSettings(next);
      setOriginalSettings(cloneSettings(next));
      setScreen("confirm-invalid-replace");
    });
    return () => { active = false; };
  }, [initialSettings, settingsPath]);

  useEffect(() => () => {
    importGeneration.current += 1;
  }, []);

  const hasChanges = useMemo(
    () => Boolean(settings && originalSettings && JSON.stringify(settings) !== JSON.stringify(originalSettings)),
    [settings, originalSettings],
  );

  const replaceSettings = (next: Settings): void => setSettings(clampSettings(next));
  const beginEdit = (nextScreen: Extract<AppScreen, "lines" | "colors" | "powerline" | "overrides" | "export" | "import">): void => {
    if (!settings) return;
    setEditSnapshot(cloneSettings(settings));
    setColorLine(null);
    setImportError(null);
    setImportPreview(null);
    setScreen(nextScreen);
  };
  const cancelEdit = (nextScreen = "main"): void => {
    if (importApplyPending.current) return;
    importGeneration.current += 1;
    if (editSnapshot) replaceSettings(editSnapshot);
    setEditSnapshot(null);
    setColorLine(null);
    setImportPreview(null);
    setScreen(nextScreen as AppScreen);
  };
  const finishEdit = (nextScreen = "main"): void => {
    setEditSnapshot(null);
    setColorLine(null);
    setImportPreview(null);
    setScreen(nextScreen as AppScreen);
  };

  const updateLine = (index: number, widgets: WidgetItem[]): void => {
    if (!settings || index < 0 || index >= settings.lines.length) return;
    const lines = settings.lines.map((line, lineIndex) => lineIndex === index ? widgets : line);
    replaceSettings({ ...settings, lines });
  };

  const saveAndExit = async (): Promise<void> => {
    if (!settings || importApplyPending.current) return;
    try {
      await writeSettings(settingsPath, settings);
      setOriginalSettings(cloneSettings(settings));
      setEditSnapshot(null);
      exit();
    } catch {
      setFlash("Could not save settings.");
      setScreen("main");
    }
  };

  const saveWithoutExit = async (): Promise<void> => {
    if (!settings || importApplyPending.current) return;
    importGeneration.current += 1;
    try {
      await writeSettings(settingsPath, settings);
      setOriginalSettings(cloneSettings(settings));
      setEditSnapshot(null);
      setImportPreview(null);
      setFlash("Configuration saved.");
      setScreen("main");
    } catch {
      setFlash("Could not save settings.");
    }
  };

  useInput((input, key) => {
    if (importApplyPending.current) return;
    if (key.ctrl && input === "c") exit();
    if (key.ctrl && input === "s" && settings && !screen.startsWith("confirm")) void saveWithoutExit();
  });

  const handleMainMenu = (value: MainMenuOption): void => {
    if (!settings) return;
    if (value === "lines" || value === "colors" || value === "powerline" || value === "overrides" || value === "export" || value === "import") {
      beginEdit(value);
    } else if (value === "save") {
      setScreen("confirm-save");
    } else {
      setScreen("confirm-discard");
    }
  };

  const exportSettings = (file: string): void => {
    if (!settings || !file) return;
    void writeFile(file, exportPreset(settings), "utf8").then(
      () => { setFlash(`Exported to ${file}`); finishEdit(); },
      () => { setFlash("Could not export settings."); },
    );
  };

  const importSettings = (file: string): void => {
    if (!file) {
      setImportError("Enter a file path.");
      return;
    }
    const request = ++importGeneration.current;
    void readImportFile(file).then((text) => {
      if (request !== importGeneration.current) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setImportError("The selected file could not be parsed.");
        return;
      }
      try {
        setImportPreview(previewImport(parsed));
        setImportError(null);
        setScreen("import-preview");
      } catch {
        setImportError("The selected file is not a supported preset.");
        return;
      }
    }, () => {
      if (request === importGeneration.current) setImportError("Could not read the selected file.");
    });
  };

  const applyImport = async (): Promise<void> => {
    if (!importPreview || importApplyPending.current) return;
    const next = importPreview.settings;
    importApplyPending.current = true;
    setImportApplying(true);
    try {
      await writeSettings(settingsPath, next);
      replaceSettings(next);
      setOriginalSettings(cloneSettings(next));
      setEditSnapshot(null);
      setImportPreview(null);
      setFlash("Imported configuration.");
      setScreen("main");
    } catch {
      setFlash("Could not save imported configuration.");
    } finally {
      importApplyPending.current = false;
      setImportApplying(false);
    }
  };

  if (!settings) {
    return <Box><Text>Loading configuration…</Text></Box>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>cxstatusline Configuration</Text>
      {flash && <Text color="yellow">{flash}</Text>}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>&gt; Preview</Text>
        <StatusLinePreview settings={settings} terminalWidth={terminalWidth} />
      </Box>
      <Box marginTop={1}>
        {screen === "main" && <MainMenu hasChanges={hasChanges} onSelect={(value) => handleMainMenu(value)} />}
        {screen === "lines" && <LineSelector
          lines={settings.lines}
          onSelect={(line) => { setSelectedLine(line); setScreen("items"); }}
          onLinesUpdate={(lines) => replaceSettings({ ...settings, lines })}
          onBack={() => cancelEdit()}
          title="Edit Lines"
          allowEditing
        />}
        {screen === "items" && <ItemsEditor
          widgets={settings.lines[selectedLine] ?? []}
          onUpdate={(widgets) => updateLine(selectedLine, widgets)}
          onBack={() => { if (settings) setEditSnapshot(cloneSettings(settings)); setScreen("lines"); }}
          lineNumber={selectedLine + 1}
          settings={settings}
        />}
        {screen === "colors" && colorLine === null && <LineSelector
          lines={settings.lines}
          onSelect={setColorLine}
          onBack={() => cancelEdit()}
          title="Edit Colors"
        />}
        {screen === "colors" && colorLine !== null && <ColorMenu
          widgets={settings.lines[colorLine] ?? []}
          lineIndex={colorLine}
          settings={settings}
          onUpdate={(widgets) => updateLine(colorLine, widgets)}
          onBack={() => setColorLine(null)}
        />}
        {screen === "powerline" && <PowerlineSetup settings={settings} onUpdate={replaceSettings} onBack={() => cancelEdit()} />}
        {screen === "overrides" && <GlobalOverridesMenu settings={settings} onUpdate={replaceSettings} onBack={() => cancelEdit()} />}
        {screen === "export" && <ExportConfigDialog
          initialPath={`${settingsPath}.export.json`}
          onExport={exportSettings}
          onCancel={() => cancelEdit()}
        />}
        {screen === "import" && <ImportConfigDialog
          error={importError}
          onFileChosen={importSettings}
          onCancel={() => cancelEdit()}
        />}
        {screen === "import-preview" && importPreview && <ImportPreviewDialog
          preview={importPreview}
          terminalWidth={terminalWidth}
          busy={importApplying}
          onConfirm={() => void applyImport()}
          onCancel={() => cancelEdit()}
        />}
        {screen === "confirm-save" && <ConfirmDialog
          message="Save the current configuration and exit?"
          onConfirm={() => void saveAndExit()}
          onCancel={() => setScreen("main")}
        />}
        {screen === "confirm-discard" && <ConfirmDialog
          message={hasChanges ? "Discard unsaved changes and exit?" : "Exit without saving?"}
          onConfirm={() => { if (originalSettings) replaceSettings(originalSettings); exit(); }}
          onCancel={() => setScreen("main")}
        />}
        {screen === "confirm-invalid-replace" && <ConfirmDialog
          message="Existing settings could not be parsed and have not been changed. Use default settings in memory? Saving later will replace the file."
          onConfirm={() => {
            const defaults = clampSettings(DEFAULT_SETTINGS);
            setSettings(defaults);
            setOriginalSettings(cloneSettings(defaults));
            setScreen("main");
          }}
          onCancel={exit}
        />}
      </Box>
    </Box>
  );
}

export async function runTUI(settingsPath: string): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[H");
  const instance = render(<App settingsPath={settingsPath} />);
  await instance.waitUntilExit();
}
