import React from "react";
import { mountInkInXterm } from "ink-web";
import { App, cloneSettings } from "../../src/tui/App";
import { SettingsSchema, type Settings } from "../../src/types/Settings";
import "@xterm/xterm/css/xterm.css";
import { PreviewFooter } from "./PreviewFooter";
import { loadSavedSettings, persistSettings } from "./settings-store";
import "./style.css";
import preset from "./sample-settings.json";

const bootButton = document.querySelector<HTMLButtonElement>("#boot")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download")!;
const editButton = document.querySelector<HTMLButtonElement>("#edit")!;
const status = document.querySelector<HTMLElement>("#status")!;
const terminalElement = document.querySelector<HTMLElement>("#terminal")!;
const shell = document.querySelector<HTMLElement>(".terminal-shell")!;
const chat = document.querySelector<HTMLElement>("#chat-preview")!;
const composer = document.querySelector<HTMLTextAreaElement>("#demo-message")!;
const copyInstallButton = document.querySelector<HTMLButtonElement>("#copy-install")!;
const copyStatus = document.querySelector<HTMLElement>("#copy-status")!;
const installCommands = document.querySelector<HTMLElement>("#install-commands")!;
const sampleSettings = SettingsSchema.parse(preset);
let savedSettings = cloneSettings(sampleSettings);
let view: "editor" | "preview" = "editor";
let mounted: ReturnType<typeof mountInkInXterm> | undefined;
let hasSavedSettings = false;
let savedDuringEdit = false;
const storage = (): Storage => window.localStorage;

function renderEditor(): void {
  view = "editor";
  savedDuringEdit = false;
  chat.hidden = true;
  editButton.hidden = true;
  shell.classList.remove("preview");
  if (mounted) {
    mounted.term.options.disableStdin = false;
    mounted.rerender(<App settingsPath="browser-memory/settings.json" initialSettings={cloneSettings(savedSettings)} writeSettings={writeSettings} onExit={showPreview} readImportFile={async () => { throw new Error("Path imports are unavailable in this browser demo."); }} />);
    setTimeout(() => mounted?.term.focus(), 0);
  }
}

function showPreview(): void {
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
  setTimeout(() => composer.focus(), 0);
}

const writeSettings = async (_path: string, settings: Settings): Promise<void> => {
  savedSettings = persistSettings(storage(), settings);
  hasSavedSettings = true;
  savedDuringEdit = true;
  downloadButton.disabled = false;
};

async function boot(): Promise<void> {
  if (mounted) return;
  bootButton.disabled = true;
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
      { container: terminalElement, focus: view === "editor", termOptions: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14, screenReaderMode: true, theme: { background: "#101315", foreground: "#e8eee8" } }, onReady: () => { if (view === "preview") showPreview(); else status.textContent = loaded.error ?? "Edit the sample, then save when ready."; } },
    );
    downloadButton.disabled = false;
  } catch (error) {
    mounted = undefined;
    bootButton.disabled = false;
    bootButton.hidden = false;
    status.textContent = `Mount failed: ${String(error)}`;
  }
}

bootButton.addEventListener("click", () => { void boot(); });
editButton.addEventListener("click", renderEditor);
downloadButton.addEventListener("click", () => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(savedSettings, null, 2)], { type: "application/json" }));
  link.href = url;
  link.download = "cxstatusline-settings.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
copyInstallButton.addEventListener("click", async () => {
  copyInstallButton.disabled = true;
  copyStatus.textContent = "";
  try {
    await navigator.clipboard.writeText(installCommands.textContent ?? "");
    copyStatus.textContent = "Copied";
  } catch {
    copyStatus.textContent = "Select and copy the commands.";
  } finally {
    copyInstallButton.disabled = false;
  }
});
void boot();
