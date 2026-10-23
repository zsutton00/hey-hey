import { isDeepStrictEqual } from 'util';

interface AgentSessionConfigShape {
  type: string;
  version: string;
  taskMonitorId?: string;
}

export type TaskMonitorStartRunConfigurationResult =
  | { status: 'not-task-monitor-owned' }
  | { status: 'incomplete-coding-session-config' }
  | { status: 'ownership-mismatch' }
  | { status: 'configuration-mismatch' }
  | { status: 'admitted' };

export const evaluateTaskMonitorStartRunConfiguration = (params: {
  contextTaskMonitorId?: string;
  requestedConfig: AgentSessionConfigShape | null | undefined;
  persistedConfig: AgentSessionConfigShape | null | undefined;
  persistedAutoDecide: boolean;
}): TaskMonitorStartRunConfigurationResult => {
  const requestedTaskMonitorId =
    params.requestedConfig?.type === 'CODING_SESSION'
      ? params.requestedConfig.taskMonitorId
      : undefined;
  const persistedTaskMonitorId =
    params.persistedConfig?.type === 'CODING_SESSION'
      ? params.persistedConfig.taskMonitorId
      : undefined;
  const hasTaskMonitorOwnership =
    params.contextTaskMonitorId !== undefined ||
    requestedTaskMonitorId !== undefined ||
    persistedTaskMonitorId !== undefined;

  if (!hasTaskMonitorOwnership) {
    return { status: 'not-task-monitor-owned' };
  }

  if (
    params.requestedConfig?.type !== 'CODING_SESSION' ||
    params.requestedConfig.version !== 'v2'
  ) {
    return { status: 'incomplete-coding-session-config' };
  }

  if (
    params.contextTaskMonitorId === undefined ||
    requestedTaskMonitorId !== params.contextTaskMonitorId ||
    persistedTaskMonitorId !== params.contextTaskMonitorId
  ) {
    return { status: 'ownership-mismatch' };
  }

  if (
    params.persistedAutoDecide !== true ||
    params.persistedConfig === null ||
    params.persistedConfig === undefined ||
    !isDeepStrictEqual(params.persistedConfig, params.requestedConfig)
  ) {
    return { status: 'configuration-mismatch' };
  }

  return { status: 'admitted' };
};
