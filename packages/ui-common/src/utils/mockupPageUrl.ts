/** Where the mockup the pencil opens comes from. */
export type MockupPageSource =
  | { kind: "workItem"; workItemId: string }
  | { kind: "proposal"; proposalId: string; sectionKey: string };

/** The local CLI page that serves a mockup at one of its sizes. */
export const buildMockupPageUrl = ({
  baseUrl,
  source,
  organizationId,
  projectId,
  sizeKey,
}: {
  baseUrl: string;
  source: MockupPageSource;
  organizationId: string;
  projectId: string;
  sizeKey: string;
}): string => {
  if (source.kind === "workItem") {
    const query = new URLSearchParams({
      organizationId,
      projectId,
      size: sizeKey,
    });
    return `${baseUrl}/mockups/${encodeURIComponent(
      source.workItemId,
    )}?${query.toString()}`;
  }
  const query = new URLSearchParams({
    organizationId,
    projectId,
    section: source.sectionKey,
    size: sizeKey,
  });
  return `${baseUrl}/mockups/proposals/${encodeURIComponent(
    source.proposalId,
  )}?${query.toString()}`;
};
