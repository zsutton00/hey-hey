import { AgentSessionConfigEntityConversationV1EffortEnum } from './generated/api';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOptionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === 'boolean';

const isProjectAssistantConfig = (value: unknown): boolean =>
  isRecord(value) &&
  isOptionalBoolean(value['enabled']) &&
  isOptionalBoolean(value['allowEdgeUpdates']) &&
  isOptionalBoolean(value['notifyDiscrepancies']) &&
  isOptionalBoolean(value['allowUpdateProposals']);

const entityConversationEfforts: ReadonlySet<string> = new Set(
  Object.values(AgentSessionConfigEntityConversationV1EffortEnum),
);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

const isVerifyFeatureConfig = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value['concern'] === 'string' &&
  value['concern'].length > 0 &&
  isUuid(value['parentAgentSessionId']) &&
  // Sessions created before the field existed omit it (spec default: []).
  (value['impactedEntities'] === undefined ||
    (Array.isArray(value['impactedEntities']) &&
      value['impactedEntities'].every(
        (entity) =>
          isRecord(entity) &&
          typeof entity['entityType'] === 'string' &&
          entity['entityType'].length > 0 &&
          isUuid(entity['entityId']),
      )));

/** Validate the agent-session config carried by a signed start-run envelope. */
export const isAgentSessionConfig = (value: unknown): boolean => {
  if (value === null) return true;
  if (!isRecord(value)) return false;

  if (value['type'] === 'CODING_SESSION_V1') {
    return value['version'] === 'v1';
  }

  if (value['type'] === 'ENTITY_CONVERSATION') {
    return (
      value['version'] === 'v1' &&
      typeof value['model'] === 'string' &&
      value['model'].trim().length > 0 &&
      (value['effort'] === undefined ||
        (typeof value['effort'] === 'string' && entityConversationEfforts.has(value['effort']))) &&
      (value['projectAssistant'] === undefined ||
        isProjectAssistantConfig(value['projectAssistant'])) &&
      isOptionalBoolean(value['disableCodexSystemPrompt']) &&
      (value['verifyFeature'] === undefined || isVerifyFeatureConfig(value['verifyFeature']))
    );
  }

  if (value['type'] === 'PROJECT_REPORT') {
    return (
      value['version'] === 'v1' &&
      isUuid(value['requestId']) &&
      isUuid(value['attemptId']) &&
      typeof value['model'] === 'string' &&
      value['model'].trim().length > 0 &&
      (value['effort'] === undefined ||
        (typeof value['effort'] === 'string' && entityConversationEfforts.has(value['effort']))) &&
      isOptionalBoolean(value['fastMode'])
    );
  }

  return (
    value['type'] === 'CODING_SESSION' &&
    value['version'] === 'v2' &&
    typeof value['model'] === 'string' &&
    value['model'].trim().length > 0 &&
    (value['planCombinationAggressiveness'] === undefined ||
      value['planCombinationAggressiveness'] === 'low' ||
      value['planCombinationAggressiveness'] === 'medium' ||
      value['planCombinationAggressiveness'] === 'high') &&
    (value['projectAssistant'] === undefined || isProjectAssistantConfig(value['projectAssistant']))
  );
};
