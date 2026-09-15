import "./style.css";
import { createElement } from "react";
import { animate, stagger } from "animejs";

const desktop = window.matchMedia("(min-width: 769px)");
const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const mobileTitle = document.querySelector<HTMLElement>("#mobile-playground-title")!;
const bootButton = document.querySelector<HTMLButtonElement>("#boot")!;
const status = document.querySelector<HTMLElement>("#status")!;
const copyInstallButton = document.querySelector<HTMLButtonElement>("#copy-install")!;
const copyStatus = document.querySelector<HTMLElement>("#copy-status")!;
const installCommands = document.querySelector<HTMLElement>("#install-commands")!;

async function mountDevelopmentReviewTools(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_AGENTATION !== "1") return;

  const agentationModule = "agentation";
  const [{ Agentation }, { createRoot }] = await Promise.all([
    import(/* @vite-ignore */ agentationModule),
    import("react-dom/client"),
  ]);
  const host = document.createElement("div");
  host.id = "agentation-root";
  document.body.append(host);
  createRoot(host).render(createElement(Agentation));
}
const intro = document.querySelector<HTMLElement>(".intro");

function animateHero(): void {
  if (!intro || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  animate(".intro-copy > *", { opacity: [0, 1], translateY: [18, 0], delay: stagger(90), duration: 650, ease: "outCubic" });
  animate(".hero-terminal", { opacity: [0, .72], translateX: [24, 0], duration: 800, delay: 220, ease: "outCubic" });
  animate(".hero-terminal-progress span", { scaleX: [0, 1], duration: 1000, delay: 520, ease: "outCubic" });
  animate(".hero-terminal-cursor", { opacity: [1, 0], duration: 650, ease: "inOutSine", loop: true, alternate: true });
}

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
animateHero();
void syncViewport();
void mountDevelopmentReviewTools();
