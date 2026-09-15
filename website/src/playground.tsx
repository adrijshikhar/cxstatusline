import React from "react";
import { mountInkInXterm } from "ink-web";
import { App, cloneSettings } from "../../src/tui/App";
import { SettingsSchema, type Settings } from "../../src/types/Settings";
import "@xterm/xterm/css/xterm.css";
import { PreviewFooter } from "./PreviewFooter";
import { loadSavedSettings, persistSettings } from "./settings-store";
import preset from "./sample-settings.json";

const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download")!;
const editButton = document.querySelector<HTMLButtonElement>("#edit")!;
const status = document.querySelector<HTMLElement>("#status")!;
const terminalElement = document.querySelector<HTMLElement>("#terminal")!;
const shell = document.querySelector<HTMLElement>(".terminal-shell")!;
const chat = document.querySelector<HTMLElement>("#chat-preview")!;
const composer = document.querySelector<HTMLTextAreaElement>("#demo-message")!;
const sampleSettings = SettingsSchema.parse(preset);
let savedSettings = cloneSettings(sampleSettings);
let view: "editor" | "preview" = "editor";
let mounted: ReturnType<typeof mountInkInXterm> | undefined;
let bootPromise: Promise<void> | undefined;
let hasSavedSettings = false;
let savedDuringEdit = false;
const storage = (): Storage => window.localStorage;

function focusCurrentView(): void {
  setTimeout(() => {
    if (view === "editor") mounted?.term.focus();
    else composer.focus();
  }, 0);
}

function renderEditor(): void {
  view = "editor";
  savedDuringEdit = false;
  chat.hidden = true;
  editButton.hidden = true;
  shell.classList.remove("preview");
  if (mounted) {
    mounted.term.options.disableStdin = false;
    mounted.rerender(<App settingsPath="browser-memory/settings.json" initialSettings={cloneSettings(savedSettings)} writeSettings={writeSettings} onExit={showPreview} readImportFile={async () => { throw new Error("Path imports are unavailable in this browser demo."); }} />);
    focusCurrentView();
  }
}

function showPreview(focus = true): void {
  view = "preview";
  chat.hidden = false;
  editButton.hidden = false;
  shell.classList.add("preview");
  if (mounted) {
    mounted.term.options.disableStdin = true;
    mounted.rerender(<PreviewFooter settings={savedSettings} />);
  }
  status.textContent = savedDuringEdit
    ? "Configuration saved in this browser."
    : hasSavedSettings ? "Showing saved browser configuration." : "Showing the sample configuration.";
  if (focus) focusCurrentView();
}

const writeSettings = async (_path: string, settings: Settings): Promise<void> => {
  savedSettings = persistSettings(storage(), settings);
  hasSavedSettings = true;
  savedDuringEdit = true;
  downloadButton.disabled = false;
};

async function startBoot(): Promise<void> {
  let loaded: ReturnType<typeof loadSavedSettings>;
  try {
    loaded = loadSavedSettings(storage());
  } catch {
    loaded = { settings: null, error: "Saved browser settings could not be loaded; using the sample." };
  }
  if (loaded.settings) { savedSettings = loaded.settings; view = "preview"; }
  hasSavedSettings = Boolean(loaded.settings);
  status.textContent = loaded.error ?? (view === "preview" ? "Loading saved browser configuration…" : "Mounting Ink Web…");
  try {
    mounted = mountInkInXterm(
      <App settingsPath="browser-memory/settings.json" initialSettings={cloneSettings(savedSettings)} writeSettings={writeSettings} onExit={showPreview} readImportFile={async () => { throw new Error("Path imports are unavailable in this browser demo."); }} />,
      { container: terminalElement, focus: false, termOptions: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14, screenReaderMode: true, theme: { background: "#282c34", foreground: "#e6e9ef" } }, onReady: () => { if (view === "preview") showPreview(false); else status.textContent = loaded.error ?? "Edit the sample, then save when ready."; } },
    );
    downloadButton.disabled = false;
  } catch (error) {
    mounted = undefined;
    throw new Error(`Mount failed: ${String(error)}`);
  }
}

export function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = startBoot().catch((error) => {
      bootPromise = undefined;
      throw error;
    });
  }
  return bootPromise;
}

export function setDesktopVisible(visible: boolean): void {
  desktopPlayground.hidden = !visible;
  desktopPlayground.inert = !visible;
  if (mounted) mounted.term.options.disableStdin = visible && view === "editor" ? false : true;
}

export { focusCurrentView };

editButton.addEventListener("click", renderEditor);
downloadButton.addEventListener("click", () => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(savedSettings, null, 2)], { type: "application/json" }));
  link.href = url;
  link.download = "cxstatusline-settings.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
