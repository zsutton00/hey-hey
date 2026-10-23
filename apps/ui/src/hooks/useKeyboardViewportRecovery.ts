import { useEffect } from "react";

const isTextEntry = (element: Element | null): boolean =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element.matches(
      'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"]',
    ));

/** Recover WebKit's root offset after keyboard dismissal without moving owned scrollports. */
export const useKeyboardViewportRecovery = (enabled: boolean): void => {
  useEffect(() => {
    const viewport = window.visualViewport;
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!enabled || !isIOS || !viewport) return;

    let fullHeight = viewport.height;
    let fullWidth = viewport.width;
    let keyboardObserved = false;
    let frame = 0;

    const reset = () => {
      keyboardObserved = false;
      fullHeight = viewport.height;
      fullWidth = viewport.width;
    };
    const measure = () => {
      frame = 0;
      // Zoom and rotation are not keyboard dismissal. Never undo their movement.
      if (
        Math.abs(viewport.scale - 1) > 0.01 ||
        Math.abs(viewport.width - fullWidth) > 2
      ) {
        reset();
        return;
      }
      if (!keyboardObserved) {
        if (
          isTextEntry(document.activeElement) &&
          fullHeight - viewport.height > 100
        ) {
          keyboardObserved = true;
        } else if (!isTextEntry(document.activeElement)) {
          fullHeight = viewport.height;
        }
        return;
      }
      if (viewport.height < fullHeight - 2) return;

      keyboardObserved = false;
      // Layout already owns root position (zero); readers scroll <main> or a
      // conversation element. Reassert only that root position after WebKit's
      // viewport resize has settled, even if its reported scrollTop is zero.
      // https://bugs.webkit.org/show_bug.cgi?id=254861#c3
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo({ top: 0, left: window.scrollX, behavior: "instant" });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", reset);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", reset);
    };
  }, [enabled]);
};
