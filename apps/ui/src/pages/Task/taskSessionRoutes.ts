export const buildTaskAgentSessionPath = (
  projectId: string,
  _initiativeId: string,
  taskId: string,
  agentSessionId: string,
): string =>
  `/projects/${projectId}/tasks/${taskId}/agent-sessions/${agentSessionId}`;

export const buildTaskPathWithAgentTab = (
  projectId: string,
  _initiativeId: string,
  taskId: string,
): string =>
  `/projects/${projectId}/tasks/${taskId}?tab=agent-sessions`;
