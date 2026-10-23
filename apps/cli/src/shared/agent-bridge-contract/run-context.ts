import type { RunContextMetadata as LocalRunContextMetadata } from './generated/api';

export type { LocalRunContextMetadata };

/**
 * Sentinel agent-session id for server-originated runs that have no real
 * agent session row (e.g. `report_update` dispatches).
 *
 * DO NOT use this from client code or pass it across the API boundary.
 * It exists only so the required `agentSessionId` field on
 * `LocalRunContextMetadata` can be populated for internal system dispatches
 * that are not tied to a user-facing agent session.
 */
export const INTERNAL_ONLY_SYSTEM_AGENT_SESSION_ID = '00000000-0000-4000-8000-000000000000';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const isRunContextMetadata = (value: unknown): value is LocalRunContextMetadata => {
  if (!isRecord(value)) {
    return false;
  }

  if (readString(value['capturedAt']) === null) {
    return false;
  }

  if (readString(value['organizationId']) === null) {
    return false;
  }

  if (readString(value['projectId']) === null) {
    return false;
  }

  if (readString(value['agentSessionId']) === null) {
    return false;
  }

  const task = value['task'];
  if (task !== undefined) {
    if (!isRecord(task)) {
      return false;
    }
    if (readString(task['id']) === null || readString(task['name']) === null) {
      return false;
    }
  }

  const launchPlanId = value['launchPlanId'];
  if (launchPlanId !== undefined && readString(launchPlanId) === null) {
    return false;
  }

  const launchStepId = value['launchStepId'];
  if (launchStepId !== undefined && readString(launchStepId) === null) {
    return false;
  }

  const launchStageId = value['launchStageId'];
  if (launchStageId !== undefined && readString(launchStageId) === null) {
    return false;
  }

  const taskMonitorId = value['taskMonitorId'];
  if (taskMonitorId !== undefined && readString(taskMonitorId) === null) {
    return false;
  }

  const userComments = value['userComments'];
  if (!isStringArray(userComments)) {
    return false;
  }

  const fileReferences = value['fileReferences'];
  if (!isRecord(fileReferences)) {
    return false;
  }

  return isStringArray(fileReferences['resolved']) && isStringArray(fileReferences['unresolved']);
};
