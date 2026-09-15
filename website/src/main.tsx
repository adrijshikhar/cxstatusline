import "./style.css";

const desktop = window.matchMedia("(min-width: 769px)");
const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const mobileTitle = document.querySelector<HTMLElement>("#mobile-playground-title")!;
const bootButton = document.querySelector<HTMLButtonElement>("#boot")!;
const status = document.querySelector<HTMLElement>("#status")!;
const copyInstallButton = document.querySelector<HTMLButtonElement>("#copy-install")!;
const copyStatus = document.querySelector<HTMLElement>("#copy-status")!;
const installCommands = document.querySelector<HTMLElement>("#install-commands")!;

let pending: Promise<typeof import("./playground")> | undefined;
let runtime: typeof import("./playground") | undefined;

function setMobileVisibility(visible: boolean): void {
  desktopPlayground.hidden = !visible;
  desktopPlayground.inert = !visible;
  if (!visible && desktopPlayground.contains(document.activeElement)) {
    mobileTitle.focus();
  }
  runtime?.setDesktopVisible(visible);
}

function showRuntimeError(): void {
  status.textContent = "The playground could not load. Try again.";
  bootButton.disabled = false;
  bootButton.hidden = false;
}

async function syncViewport(): Promise<void> {
  if (!desktop.matches) {
    setMobileVisibility(false);
    return;
  }

  bootButton.disabled = true;
  try {
    pending ??= import("./playground");
    runtime = await pending;
    if (!desktop.matches) return;
    setMobileVisibility(true);
    await runtime.boot();
    bootButton.hidden = true;
  } catch {
    pending = undefined;
    runtime = undefined;
    showRuntimeError();
  }
}

desktop.addEventListener("change", () => { void syncViewport(); });
bootButton.addEventListener("click", () => {
  pending = undefined;
  void syncViewport();
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

setMobileVisibility(desktop.matches);
void syncViewport();
