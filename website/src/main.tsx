import { createElement } from "react";
import { animate, stagger } from "animejs";

const desktop = window.matchMedia("(min-width: 769px)");
const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const featuresTitle = document.querySelector<HTMLElement>("#features-title")!;
const bootButton = document.querySelector<HTMLButtonElement>("#boot")!;
const status = document.querySelector<HTMLElement>("#status")!;
const copyInstall = document.querySelector<HTMLButtonElement>("#copy-install")!;

async function mountDevelopmentReviewTools(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.PUBLIC_ENABLE_AGENTATION !== "1") return;

  const [{ Agentation }, { createRoot }] = await Promise.all([
    import("agentation"),
    import("react-dom/client"),
  ]);
  const host = document.createElement("div");
  host.id = "agentation-root";
  document.body.append(host);
  createRoot(host).render(createElement(Agentation));
}
let pending: Promise<typeof import("./playground")> | undefined;
let runtime: typeof import("./playground") | undefined;

function setMobileVisibility(visible: boolean): void {
  desktopPlayground.hidden = !visible;
  desktopPlayground.inert = !visible;
  if (!visible && desktopPlayground.contains(document.activeElement)) {
    featuresTitle.focus();
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
copyInstall.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(copyInstall.dataset.commands!);
    copyInstall.textContent = "Copied";
  } catch {
    copyInstall.textContent = "Copy failed";
  }
  setTimeout(() => { copyInstall.textContent = "Copy"; }, 1500);
});

setMobileVisibility(desktop.matches);
void syncViewport();
void mountDevelopmentReviewTools();

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  animate(".intro-copy > *", {
    opacity: [0.75, 1],
    translateY: [12, 0],
    duration: 650,
    delay: stagger(90),
    ease: "outExpo",
  });
}
