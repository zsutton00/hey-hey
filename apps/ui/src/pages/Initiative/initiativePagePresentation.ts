export const buildInitiativePresentationSnapshot = (label: string) => ({
  kind: "initiative" as const,
  label,
});
