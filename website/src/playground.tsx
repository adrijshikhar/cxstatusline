import { mountInkInXterm } from "ink-web";
import type React from "react";
import { App, cloneSettings } from "../../src/tui/App";
import { SettingsSchema, type Settings } from "../../src/types/Settings";
import { PreviewFooter } from "./PreviewFooter";
import { loadSavedSettings, persistSettings } from "./settings-store";
import preset from "./sample-settings.json";

const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const featuresTitle = document.querySelector<HTMLElement>("#features-title")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download")!;
const editButton = document.querySelector<HTMLButtonElement>("#edit")!;
const status = document.querySelector<HTMLElement>("#status")!;
const hint = document.querySelector<HTMLElement>(".terminal-hint")!;
const skeleton = document.querySelector<HTMLElement>("#playground-skeleton")!;
const terminalElement = document.querySelector<HTMLElement>("#terminal")!;
const shell = document.querySelector<HTMLElement>(".terminal-shell")!;
const chat = document.querySelector<HTMLElement>("#chat-preview")!;
const composer = document.querySelector<HTMLInputElement>("#demo-message")!;
const sampleSettings = SettingsSchema.parse(preset);
const previewRows = 3;
const previewHeight = "52px";
let savedSettings = cloneSettings(sampleSettings);
let view: "editor" | "preview" = "editor";
let mounted: ReturnType<typeof mountInkInXterm> | undefined;
let bootPromise: Promise<void> | undefined;
let hasSavedSettings = false;

function focusCurrentView(): void {
  setTimeout(() => {
    if (view === "editor") mounted?.term.focus();
    else composer.focus();
  }, 0);
}

async function renderEditor(): Promise<void> {
  view = "editor";
  chat.hidden = true;
  editButton.hidden = true;
  shell.classList.remove("preview");
  hint.textContent = "Arrow keys and Enter to edit · Tab to leave the terminal";
  hint.hidden = false;
  status.textContent = hasSavedSettings ? "Editing saved layout" : "Editing sample layout";
  terminalElement.inert = true;
  terminalElement.style.height = "";
  if (!mounted) return;
  await mounted.unmount();
  terminalElement.replaceChildren();
  if (view !== "editor") return;
  mountView(editorView(), () => {
    terminalElement.inert = false;
    focusCurrentView();
  });
}

function terminalLineHeight(): number {
  const term = mounted?.term;
  const cellHeight = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } } })?._core?._renderService?.dimensions?.css?.cell?.height;
  if (typeof cellHeight === "number" && cellHeight > 0) return cellHeight;
  const screen = term?.element?.querySelector<HTMLElement>(".xterm-screen");
  if (screen && term.rows > 0) {
    const measuredHeight = screen.getBoundingClientRect().height / term.rows;
    if (measuredHeight > 0) return measuredHeight;
  }
  return Math.max(1, (term?.options.fontSize ?? 14) * 1.5);
}

function showPreview(focus = true): void {
  view = "preview";
  chat.hidden = false;
  composer.disabled = false;
  editButton.hidden = false;
  shell.classList.add("preview");
  hint.textContent = "";
  hint.hidden = true;
  terminalElement.inert = true;
  const rows = Math.max(savedSettings.lines.length, previewRows);
  terminalElement.style.height = `${Math.ceil(rows * terminalLineHeight() + 4)}px`;
  if (mounted) {
    mounted.term.options.disableStdin = true;
    mounted.term.reset();
    mounted.rerender(<PreviewFooter settings={savedSettings} />);
  }
  status.textContent = hasSavedSettings ? "Saved in this browser" : "Sample preview";
  if (focus) focusCurrentView();
}

const writeSettings = async (_path: string, settings: Settings): Promise<void> => {
  savedSettings = persistSettings(window.localStorage, settings);
  hasSavedSettings = true;
  downloadButton.disabled = false;
};

async function rejectBrowserImport(): Promise<never> {
  throw new Error("Path imports are unavailable in this browser demo.");
}

function editorView() {
  return <App settingsPath="browser-memory/settings.json" initialSettings={cloneSettings(savedSettings)} writeSettings={writeSettings} onExit={showPreview} readImportFile={rejectBrowserImport} />;
}

function mountView(element: React.ReactElement, onReady: () => void): void {
  mounted = mountInkInXterm(element, {
    container: terminalElement,
    focus: false,
    termOptions: {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 14,
      screenReaderMode: true,
      theme: {
        background: getComputedStyle(shell).getPropertyValue("--terminal").trim(),
        foreground: getComputedStyle(shell).getPropertyValue("--text").trim(),
        cursor: getComputedStyle(shell).getPropertyValue("--accent").trim(),
        selectionBackground: getComputedStyle(shell).getPropertyValue("--line").trim(),
      },
    },
    onReady,
  });
  // Fit xterm before Ink's first render so both start with the same column count.
  window.dispatchEvent(new Event("resize"));
  attachTerminalFocusHandler();
}

function attachTerminalFocusHandler(): void {
  if (!mounted) return;
  mounted.term.attachCustomKeyEventHandler((event) => {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return true;
    if (event.type === "keydown") {
      event.preventDefault();
      const controls = [...document.querySelectorAll<HTMLButtonElement>("#desktop-playground .actions button:not([disabled]):not([hidden])")];
      const target = event.shiftKey ? controls.at(-1) : featuresTitle;
      target?.focus();
    }
    return false;
  });
}

async function startBoot(): Promise<void> {
  let loaded: ReturnType<typeof loadSavedSettings>;
  try {
    loaded = loadSavedSettings(window.localStorage);
  } catch {
    loaded = { settings: null, error: "Saved browser settings could not be loaded; using the sample." };
  }
  if (loaded.settings) {
    savedSettings = loaded.settings;
    view = "preview";
    chat.hidden = false;
    editButton.hidden = false;
    shell.classList.add("preview");
    terminalElement.style.height = previewHeight;
    hint.textContent = "";
  } else {
    chat.hidden = true;
    shell.classList.remove("preview");
    terminalElement.style.height = "";
  }
  hasSavedSettings = Boolean(loaded.settings);
  downloadButton.disabled = false;
  status.textContent = loaded.error ?? (view === "preview" ? "Loading saved layout…" : "Opening editor…");
  try {
    terminalElement.inert = true;
    const initialView = view === "preview"
      ? <PreviewFooter settings={savedSettings} />
      : editorView();
    mountView(initialView, () => {
      if (view === "preview") showPreview(false);
      else {
        terminalElement.inert = false;
        status.textContent = loaded.error ?? "Editing sample layout";
        hint.hidden = false;
      }
      skeleton.hidden = true;
    });
  } catch (error) {
    skeleton.hidden = true;
    if (mounted) await mounted.unmount();
    mounted = undefined;
    terminalElement.replaceChildren();
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

editButton.addEventListener("click", () => { void renderEditor(); });
downloadButton.addEventListener("click", () => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(savedSettings, null, 2)], { type: "application/json" }));
  link.href = url;
  link.download = "cxstatusline-settings.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
