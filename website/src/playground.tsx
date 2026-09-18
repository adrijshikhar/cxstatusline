import { mountInkInXterm } from "ink-web";
import { animate } from "animejs";
import type React from "react";
import { App, cloneSettings } from "../../src/tui/App";
import { SettingsSchema, type Settings } from "../../src/types/Settings";
import { migrateSettings } from "../../src/utils/migrations";
import defaultLayout from "./sample-settings.json";
import { PreviewFooter } from "./PreviewFooter";
import { loadSavedSettings, persistSettings } from "./settings-store";

const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const featuresTitle = document.querySelector<HTMLElement>("#features-title")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download")!;
const importButton = document.querySelector<HTMLButtonElement>("#import");
const editButton = document.querySelector<HTMLButtonElement>("#edit")!;
const status = document.querySelector<HTMLElement>("#status")!;
const skeleton = document.querySelector<HTMLElement>("#playground-skeleton")!;
const terminalElement = document.querySelector<HTMLElement>("#terminal")!;
const shell = document.querySelector<HTMLElement>(".terminal-shell")!;
const chat = document.querySelector<HTMLElement>("#chat-preview")!;
let savedSettings = SettingsSchema.parse(defaultLayout);
let view: "editor" | "preview" = "preview";
let mounted: ReturnType<typeof mountInkInXterm> | undefined;
let bootPromise: Promise<void> | undefined;
let hasSavedSettings = false;
let statusAnimation: ReturnType<typeof animate> | undefined;

function statusPart(className: string, text: string): HTMLSpanElement {
  const part = document.createElement("span");
  part.className = className;
  part.textContent = text;
  return part;
}

function setStatus(text: string, className = "status-muted"): void {
  statusAnimation?.cancel();
  const dot = statusPart(`status-dot ${className}`, "●");
  dot.ariaHidden = "true";
  status.replaceChildren(dot, statusPart("status-muted", ` ${text}`));
}

function animateStatusDot(dot: HTMLElement, loading = false): void {
  statusAnimation?.cancel();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rootStyles = getComputedStyle(document.documentElement);
  statusAnimation = animate(dot, loading
    ? {
        color: [rootStyles.getPropertyValue("--signal-info").trim(), rootStyles.getPropertyValue("--muted").trim()],
        duration: 750,
        alternate: true,
        loop: true,
        ease: "inOutSine",
      }
    : {
        opacity: [.35, 1],
        scale: [.8, 1],
        duration: 900,
        alternate: true,
        loop: true,
        ease: "inOutSine",
      },
  );
}

function setLoadingStatus(text: string): void {
  const dot = statusPart("status-dot status-loading", "●");
  dot.ariaHidden = "true";
  status.replaceChildren(dot, statusPart("status-muted", ` ${text}`));
  animateStatusDot(dot, true);
}

function setEditorStatus(): void {
  const dot = statusPart("status-dot status-editing", "●");
  dot.ariaHidden = "true";
  status.replaceChildren(
    dot,
    document.createTextNode(" "),
    statusPart("status-muted", "Edit in progress"),
    statusPart("status-hint", " · ↑↓ navigate · Enter select · Tab moves focus"),
  );
  animateStatusDot(dot);
}

function focusCurrentView(): void {
  setTimeout(() => {
    if (view === "editor") mounted?.term.focus();
    else editButton.focus();
  }, 0);
}

async function renderEditor(): Promise<void> {
  view = "editor";
  chat.hidden = true;
  editButton.hidden = true;
  shell.classList.remove("preview");
  setEditorStatus();
  terminalElement.inert = true;
  if (!mounted) return;
  await mounted.unmount();
  terminalElement.replaceChildren();
  if (view !== "editor") return;
  mountView(editorView(), () => {
    terminalElement.inert = false;
    focusCurrentView();
  });
}

function showPreview(focus = true, rerender = true): void {
  view = "preview";
  chat.hidden = false;
  editButton.hidden = false;
  shell.classList.add("preview");
  terminalElement.inert = true;
  if (mounted) {
    mounted.term.options.disableStdin = true;
    if (rerender) {
      mounted.term.reset();
      mounted.rerender(<PreviewFooter settings={savedSettings} />);
    }
  }
  setStatus(hasSavedSettings ? "Saved in this browser" : "Default settings preview", hasSavedSettings ? "status-saved" : "status-muted");
  if (focus) focusCurrentView();
}

async function writeSettings(_path: string, settings: Settings): Promise<void> {
  savedSettings = persistSettings(window.localStorage, settings);
  hasSavedSettings = true;
  downloadButton.disabled = false;
  if (view === "editor") setEditorStatus();
}

function pickImportFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    document.body.append(input);
    const finish = () => { input.remove(); focusCurrentView(); };
    input.addEventListener("cancel", () => { finish(); resolve(null); }, { once: true });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      try {
        if (file && file.size > 1_000_000) throw new Error("File exceeds 1 MB");
        resolve(file ? await file.text() : null);
      } catch (error) {
        reject(error);
      } finally {
        finish();
      }
    }, { once: true });
    input.click();
  });
}

function editorView() {
  return <App settingsPath="browser-memory/settings.json" initialSettings={cloneSettings(savedSettings)} writeSettings={writeSettings} onExit={showPreview} pickImportFile={pickImportFile} />;
}

function mountView(element: React.ReactElement, onReady: () => void): void {
  mounted = mountInkInXterm(element, {
    container: terminalElement,
    focus: false,
    termOptions: {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: parseFloat(getComputedStyle(terminalElement).fontSize),
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
    loaded = { settings: null, error: "Saved browser settings could not be loaded; using defaults." };
  }
  if (loaded.settings) savedSettings = loaded.settings;
  view = "preview";
  chat.hidden = false;
  shell.classList.add("preview");
  hasSavedSettings = Boolean(loaded.settings);
  downloadButton.disabled = false;
  if (loaded.error) setStatus(loaded.error);
  else setLoadingStatus(loaded.settings ? "Loading saved layout…" : "Loading default settings…");
  try {
    terminalElement.inert = true;
    const initialView = <PreviewFooter settings={savedSettings} />;
    mountView(initialView, () => {
      showPreview(false, false);
      if (loaded.error) setStatus(loaded.error);
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
  if (mounted) mounted.term.options.disableStdin = !(visible && view === "editor");
}

function downloadJsonFile(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function handleImport(): Promise<void> {
  try {
    const text = await pickImportFile();
    if (!text) return;
    const raw = JSON.parse(text);
    const migration = migrateSettings(raw);
    if (migration.unknownVersion) throw new Error("Unsupported settings version");
    const validated = SettingsSchema.parse(migration.settings);
    savedSettings = persistSettings(window.localStorage, validated);
    hasSavedSettings = true;
    downloadButton.disabled = false;
    setStatus("Saved in this browser", "status-saved");
    if (view === "preview") {
      showPreview(true, true);
    } else {
      await renderEditor();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Import failed: ${message}`, "status-editing");
  }
}

editButton.addEventListener("click", () => { void renderEditor(); });
importButton?.addEventListener("click", () => { void handleImport(); });
downloadButton.addEventListener("click", () => {
  downloadJsonFile("cxstatusline-settings.json", savedSettings);
});
