/** Explicit moves only; content resizing is left to native scroll anchoring. */
export function revealLatestConversationContent(owner: HTMLElement): void {
  owner.scrollTo({ top: owner.scrollHeight, behavior: "instant" });
}

export function navigateToConversationTarget(
  owner: HTMLElement,
  target: HTMLElement,
  behavior: ScrollBehavior = "smooth"
): void {
  if (!owner.contains(target)) return;
  const top =
    owner.scrollTop +
    target.getBoundingClientRect().top -
    owner.getBoundingClientRect().top -
    owner.clientTop;
  owner.scrollTo({ top: Math.max(0, top), behavior });
}

/** Observe mounting only until an explicit move can be performed. */
export function waitForConversationTarget(
  owner: HTMLElement,
  findTarget: () => HTMLElement | null,
  onMounted: (target: HTMLElement) => void
): () => void {
  const attempt = () => {
    const target = findTarget();
    if (!target || !owner.contains(target)) return false;
    onMounted(target);
    return true;
  };
  if (attempt()) return () => {};
  const observer = new MutationObserver(() => {
    if (attempt()) observer.disconnect();
  });
  observer.observe(owner, { childList: true, subtree: true });
  return () => observer.disconnect();
}
