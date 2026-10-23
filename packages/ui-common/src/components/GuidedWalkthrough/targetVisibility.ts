/** Readiness only: visibility never completes an action. */
export function isGuidableTargetVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (
    let ancestor: HTMLElement | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (
      ancestor.hidden ||
      ancestor.inert ||
      ancestor.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    )
      return false;
  }
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}
