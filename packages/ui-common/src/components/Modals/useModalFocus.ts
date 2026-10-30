import { useEffect, useRef, type FocusEvent } from "react";

const fallbackControl = (root: HTMLElement) =>
  root
    .querySelector<HTMLElement>(".MuiDialog-paper")
    ?.querySelector<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]',
    ) ?? root.querySelector<HTMLElement>(".MuiDialog-container");

export function useModalFocus(visible: boolean, root: HTMLElement | null) {
  const lastContentFocus = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(false);
  useEffect(() => {
    // MUI may attach the portal root after visibility changes. Wait for it
    // before consuming the hidden-to-visible transition.
    if (visible && !root) return;
    if (!visible && wasVisible.current)
      previousFocus.current = lastContentFocus.current;
    const restoring =
      visible && !wasVisible.current && previousFocus.current !== null;
    wasVisible.current = visible;
    if (!restoring || !root) return;
    const frame = requestAnimationFrame(() => {
      const paper = root.querySelector<HTMLElement>(".MuiDialog-paper");
      const control = previousFocus.current;
      if (
        control?.isConnected &&
        paper?.contains(control) &&
        !control.matches(":disabled, [hidden]") &&
        getComputedStyle(control).display !== "none" &&
        getComputedStyle(control).visibility !== "hidden"
      )
        control.focus();
      else fallbackControl(root)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, root]);
  const rememberFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(".MuiDialog-paper") &&
      !event.target.closest('[data-testid="modal-window-controls"]')
    )
      lastContentFocus.current = event.target;
  };
  const saveFocus = () => {
    previousFocus.current =
      lastContentFocus.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
  };
  return { rememberFocus, saveFocus };
}
