import { createElement } from "react";
import { animate, stagger } from "animejs";

const desktop = window.matchMedia("(min-width: 769px)");
const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const featuresTitle = document.querySelector<HTMLElement>("#features-title")!;
const bootButton = document.querySelector<HTMLButtonElement>("#boot")!;
const status = document.querySelector<HTMLElement>("#status")!;
const releaseVersion = document.querySelector<HTMLElement>("#release-version");
const releaseSync = document.querySelector<HTMLElement>("#release-sync");

async function refreshReleaseVersion(): Promise<void> {
  if (!releaseSync) return;
  const abort = new AbortController();
  const timeout = window.setTimeout(() => abort.abort(), 4_000);
  try {
    const response = await fetch("https://registry.npmjs.org/cxstatusline/latest", { signal: abort.signal });
    const payload: unknown = await response.json();
    const version = typeof payload === "object" && payload !== null && "version" in payload && typeof payload.version === "string" ? payload.version : null;
    if (!response.ok || !version) throw new Error("npm registry did not return a version");
    if (releaseVersion) releaseVersion.textContent = `v${version}`;
    releaseSync.textContent = "live";
    releaseSync.title = "Live npm release";
  } catch {
    releaseSync.textContent = "refresh failed";
    releaseSync.title = releaseSync.textContent;
  } finally {
    window.clearTimeout(timeout);
  }
}

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
let stylesPending: Promise<void> | undefined;

function loadPlaygroundStyles(): Promise<void> {
  return stylesPending ??= new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/editor.css";
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("Could not load playground styles"));
    document.head.append(link);
  });
}

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
    await loadPlaygroundStyles();
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
setMobileVisibility(desktop.matches);
void syncViewport();
void mountDevelopmentReviewTools();
void refreshReleaseVersion();

const composer = document.querySelector<HTMLInputElement>("#demo-message")!;
const composerCursor = document.querySelector<HTMLElement>(".composer-cursor")!;
function updateComposerCursor(): void {
  composerCursor.textContent = composer.value.slice(0, composer.selectionStart ?? 0);
  composerCursor.style.translate = `${-composer.scrollLeft}px 0`;
  composerCursor.hidden = composer.selectionStart !== composer.selectionEnd;
}
for (const event of ["input", "selectionchange", "scroll", "focus"]) {
  composer.addEventListener(event, updateComposerCursor);
}

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  function animateTerminalButton(button: HTMLElement, active: boolean): void {
    const styles = getComputedStyle(button);
    const color = active
      ? styles.getPropertyValue("--terminal").trim()
      : styles.getPropertyValue("--terminal-button-idle").trim();
    animate(button.querySelector("[data-terminal-bracket='open']")!, {
      translateX: active ? -2 : 0,
      duration: active ? 280 : 360,
      ease: "outQuart",
    });
    animate(button.querySelector("[data-terminal-bracket='close']")!, {
      translateX: active ? 2 : 0,
      duration: active ? 280 : 360,
      ease: "outQuart",
    });
    animate(button.querySelector("[data-terminal-label]")!, {
      letterSpacing: active ? ".035em" : "0em",
      duration: active ? 280 : 360,
      ease: "outQuart",
    });
    animate(button, {
      color,
      backgroundColor: active ? styles.getPropertyValue("--accent-strong").trim() : "rgba(125, 211, 252, 0)",
      duration: active ? 320 : 420,
      ease: "outQuart",
    });
  }

  document.querySelectorAll<HTMLElement>(".terminal-button").forEach((button) => {
    const update = () => animateTerminalButton(button, button.matches(":hover, :focus-visible"));
    button.addEventListener("pointerenter", update);
    button.addEventListener("pointerleave", update);
    button.addEventListener("focus", update);
    button.addEventListener("blur", update);
  });

  animate("[data-dot-field]", {
    opacity: [0, desktop.matches ? .9 : .7],
    duration: 900,
    ease: "outExpo",
  });
  animate("#playground-skeleton [data-slot='skeleton']", {
    opacity: [.3, 1],
    duration: 900,
    delay: stagger(120),
    alternate: true,
    loop: 3,
    ease: "inOutSine",
  });
  animate(".terminal-window, .terminal-chrome > *, #playground", {
    opacity: [0, 1],
    duration: 600,
    delay: stagger(70),
    ease: "outExpo",
  });
  animate(".ascii-wordmark", {
    opacity: [0, 1],
    duration: 700,
    delay: 400,
    ease: "outSine",
  });
  animate("[data-transcript-prompt]", { opacity: [0, 1], duration: 700, delay: 1_150, ease: "outSine" });
  const reply = document.querySelector<HTMLElement>("[data-transcript-reply]")!;
  reply.inert = true;
  animate(reply, {
    opacity: [0, 1], duration: 700, delay: 1_900, ease: "outSine",
    onComplete: () => { reply.inert = false; },
  });

  const animations = new WeakMap<Element, ReturnType<typeof animate>>();
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      reveal.unobserve(entry.target);
      animations.get(entry.target)?.play();
    }
  }, { threshold: .12 });

  const setupScrollReveals = () => {
    document.querySelectorAll(".content-section:not(#faq), .site-footer").forEach((section) => {
      const children = section.querySelectorAll(":scope > *");
      animations.set(section, animate(children.length ? children : section, {
        autoplay: false,
        opacity: [0, 1],
        translateY: [28, 0],
        duration: 850,
        delay: stagger(110),
        ease: "outExpo",
      }));
      reveal.observe(section);
    });
  };
  if (document.readyState === "complete") setupScrollReveals();
  else window.addEventListener("load", setupScrollReveals, { once: true });
}
