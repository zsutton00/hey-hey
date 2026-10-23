export function normalizeProposalReturnTarget(
  returnTo: string | null,
): string | null {
  if (!returnTo?.startsWith("/") || returnTo.startsWith("//")) return null;
  try {
    const parsed = new URL(returnTo, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
