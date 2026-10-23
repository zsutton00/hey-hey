export interface AgentSessionLabelData {
  title?: string | null;
}

const normalizeForCompare = (value: string): string =>
  value.trim().toLowerCase();

export const buildAgentSessionLabel = (
  agentSession: AgentSessionLabelData,
  serviceName: string | undefined,
  parentLabel?: string,
): string => {
  const fallback = "Agent Session";
  const rawTitle = agentSession.title?.trim() || "";
  const duplicatesParent =
    Boolean(rawTitle) &&
    Boolean(parentLabel) &&
    normalizeForCompare(rawTitle) === normalizeForCompare(parentLabel ?? "");

  if (duplicatesParent) {
    return serviceName || fallback;
  }

  const title = rawTitle || fallback;
  return serviceName ? `${serviceName} - ${title}` : title;
};
