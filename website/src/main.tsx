import { createElement } from "react";
import { animate, stagger } from "animejs";

const desktop = window.matchMedia("(min-width: 769px)");
const desktopPlayground = document.querySelector<HTMLElement>("#desktop-playground")!;
const featuresTitle = document.querySelector<HTMLElement>("#features-title")!;
const bootButton = document.querySelector<HTMLButtonElement>("#boot")!;
const status = document.querySelector<HTMLElement>("#status")!;

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
setMobileVisibility(desktop.matches);
void syncViewport();
void mountDevelopmentReviewTools();

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  animate("[data-dot-field]", {
    opacity: [0, .72],
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
  animate(".intro > *", {
    opacity: [0.55, 1],
    translateY: [10, 0],
    duration: 700,
    delay: stagger(110),
    ease: "outExpo",
  });
  animate(".prompt-line", {
    clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"],
    duration: 850,
    delay: 160,
    ease: "outExpo",
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
    document.querySelectorAll(".content-section, .site-footer").forEach((section) => {
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
