import { randomUUID } from 'node:crypto';
import {
  AgentRequestPermissionPayloadResponseTypeEnum,
  ExtendedUIFieldType,
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type AgentRequestPermissionPayload,
  type CodingPromptMergedFinalAssessmentPayload,
  type CreateSystemMessage,
  type CreateUserMessage,
  type PermissionRequestAgentType,
  type QuestionsSystemMessageData,
  type SystemMessageData,
  type SystemMessageDataActionHintEnum,
  type UIElement,
  type UIElementPayload,
  type UserMessageData,
} from '../shared/api/index';
import type { CodingPromptStartupPlanPayload } from '../shared/api/generated/api';
import type {
  LocalFinalAssessmentResponse,
  LocalStartupSessionPlanResponse,
} from '../shared/agent-bridge-contract/index';
import type { PlanShapingFeatureSyncIterateResponse } from './response-schemas';
import {
  parseFinalAssessmentResponseFromText,
  parsePlanShapingFeatureSyncIterateResponseFromText,
  parseStartupSessionPlanResponseFromText,
} from './response-parser';
import { renderStartupPlanSummary } from '../agent-runtime/index';

const nextUiElementId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const UI_ELEMENT_IDS = {
  permission_request_v1: 'agent-request-permission',
  agent_complete: 'agent-complete',
} as const;

const AGENT_COMPLETE_UI_ELEMENT: UIElement = {
  id: UI_ELEMENT_IDS.agent_complete,
  type: ExtendedUIFieldType.AgentComplete,
  label: 'Agent Complete',
};

type StructuredResponseType = 'final_assessment_v2' | 'startup_plan_v1';

const DEFAULT_STRUCTURED_RESPONSE_TYPES: readonly StructuredResponseType[] = [
  'final_assessment_v2',
  'startup_plan_v1',
];

const STRUCTURED_UI_ELEMENT_TEMPLATES: Record<StructuredResponseType, Omit<UIElement, 'id'>> = {
  final_assessment_v2: {
    type: ExtendedUIFieldType.CodingPromptFinalAssessment,
    label: 'Final Assessment',
  },
  startup_plan_v1: {
    type: ExtendedUIFieldType.CodingPromptStartupPlan,
    label: 'Startup Plan',
    submitText: 'Approve',
  },
};

interface DailySessionParsedResponse {
  response: string;
  conversationTitle: string;
  suggestedActions?: string[];
  relatedEntities?: Array<Record<string, unknown>>;
  influences?: Array<Record<string, unknown>>;
}

type KnownStructuredResponse =
  | {
      responseType: 'final_assessment_v2';
      parsed: LocalFinalAssessmentResponse;
    }
  | {
      responseType: 'startup_plan_v1';
      parsed: LocalStartupSessionPlanResponse;
    };

export const toCodingPromptStartupPlanPayload = (
  plan: LocalStartupSessionPlanResponse,
): CodingPromptStartupPlanPayload => ({
  responseType: plan.responseType,
  sessionTitle: plan.sessionTitle,
  requiredServiceIds: plan.requiredServiceIds,
  primaryImplementations: plan.primaryImplementations.map((implementation) => ({
    title: implementation.title,
    content: implementation.content,
    rationale: implementation.rationale,
    ...(implementation.location ? { location: implementation.location } : {}),
    ...(implementation.language ? { language: implementation.language } : {}),
    ...(implementation.connections
      ? {
          connections: implementation.connections.map((connection) => ({ ...connection })),
        }
      : {}),
  })),
  executionPlan: plan.executionPlan.map((step) => ({ ...step })),
  discrepancies: plan.discrepancies.map((discrepancy) => ({ ...discrepancy })),
  clarificationQuestions: plan.clarificationQuestions.map((question) => ({ ...question })),
});

// -- JSON extraction helpers --

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readStringByKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const result = readNonEmptyString(value[key]);
    if (result) return result;
  }
  return null;
};

const readStringArrayByKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): string[] => {
  for (const key of keys) {
    const next = value[key];
    if (!Array.isArray(next)) continue;
    const normalized = next
      .map((entry) => readNonEmptyString(entry))
      .filter((entry): entry is string => entry !== null);
    if (normalized.length > 0) return normalized;
  }
  return [];
};

const readRecordKeys = (value: unknown): string[] => {
  if (!isRecord(value)) {
    return [];
  }
  return Object.keys(value);
};

const extractJsonPayload = (text: string): string | null => {
  const trimmed = text.trim();

  // When the text itself is JSON (starts with '{'), go straight to brace
  // matching. The fenced-code-block regex can false-positive on backtick
  // fences embedded inside JSON string values (e.g. markdown content in a
  // Write tool's file content field).
  if (!trimmed.startsWith('{')) {
    const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let fallback: string | null = null;
    for (const match of text.matchAll(fenceRegex)) {
      const content = match[1]?.trim();
      if (!content) continue;
      if (!fallback) fallback = content;
      if (content.includes('"responseType"')) return content;
    }
    if (fallback) return fallback;
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return text.slice(firstBrace, lastBrace + 1).trim();
};

const parseJsonRecord = (text: string): Record<string, unknown> | null => {
  const payload = extractJsonPayload(text);
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// -- Permission request parsing --

const isPermissionRequestResponseType = (value: unknown): boolean =>
  value === 'agent_request_permission_v1' ||
  value === 'agent-request-permission-v1' ||
  value === 'agent_request_permission' ||
  value === 'agent-request-permission';

const toPermissionRequestAgentType = (value: string | null): PermissionRequestAgentType | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'codex' || normalized === 'opencode')
    return normalized;
  return null;
};

const readPermissionRequestRecord = (
  value: Record<string, unknown>,
): Record<string, unknown> | null => {
  for (const key of ['permission_request', 'permissionRequest']) {
    const candidate = value[key];
    if (isRecord(candidate)) return candidate;
  }
  return null;
};

const readPermissionRootRecord = (
  value: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (readPermissionRequestRecord(value)) return value;
  const payload = value['payload'];
  if (isRecord(payload) && readPermissionRequestRecord(payload)) return payload;
  return null;
};

const readEnrichmentRecord = (
  root: Record<string, unknown>,
  permissionRequest: Record<string, unknown>,
): Record<string, unknown> | null => {
  for (const candidate of [
    root['enrichment'],
    root['enrichment_metadata'],
    root['enrichmentMetadata'],
    permissionRequest['enrichment'],
    permissionRequest['enrichment_metadata'],
    permissionRequest['enrichmentMetadata'],
  ]) {
    if (isRecord(candidate)) return candidate;
  }
  return null;
};

const readRawEventRecord = (
  root: Record<string, unknown>,
  permissionRoot: Record<string, unknown>,
  permissionRequest: Record<string, unknown>,
): Record<string, unknown> | null => {
  for (const source of [root, permissionRoot, permissionRequest]) {
    for (const key of ['raw_event', 'rawEvent']) {
      const candidate = source[key];
      if (isRecord(candidate)) return candidate;
    }
  }
  return null;
};

export const tryParsePermissionRequestResponse = (
  text: string,
): AgentRequestPermissionPayload | null => {
  const parsed = parseJsonRecord(text);
  if (!parsed) return null;

  const permissionRoot = readPermissionRootRecord(parsed);
  if (!permissionRoot) return null;

  const permissionRequestRecord = readPermissionRequestRecord(permissionRoot);
  if (!permissionRequestRecord) return null;

  if (
    parsed['responseType'] !== undefined &&
    !isPermissionRequestResponseType(parsed['responseType'])
  ) {
    return null;
  }

  const id = readStringByKeys(permissionRequestRecord, ['id']);
  const permissionType = readStringByKeys(permissionRequestRecord, [
    'permission_type',
    'permissionType',
  ]);
  const sessionId = readStringByKeys(permissionRequestRecord, ['session_id', 'sessionId']);
  const agentId = readStringByKeys(permissionRequestRecord, ['agent_id', 'agentId']);
  const agentType = toPermissionRequestAgentType(
    readStringByKeys(permissionRequestRecord, ['agent_type', 'agentType']),
  );
  const runId = readStringByKeys(permissionRequestRecord, ['run_id', 'runId']);
  const timestamp = readStringByKeys(permissionRequestRecord, ['timestamp']);
  const idempotencyToken = readStringByKeys(permissionRequestRecord, [
    'idempotency_token',
    'idempotencyToken',
  ]);

  if (
    !id ||
    !permissionType ||
    !sessionId ||
    !agentId ||
    !agentType ||
    !timestamp ||
    !idempotencyToken
  ) {
    return null;
  }

  const enrichment =
    readEnrichmentRecord(parsed, permissionRequestRecord) ??
    readEnrichmentRecord(permissionRoot, permissionRequestRecord);
  const reason = enrichment
    ? readStringByKeys(enrichment, ['reason', 'human_reason', 'humanReason', 'summary'])
    : null;
  const agentIntent = enrichment
    ? readStringByKeys(enrichment, ['agent_intent', 'agentIntent', 'intent'])
    : null;
  const referencedFiles = enrichment
    ? readStringArrayByKeys(enrichment, ['referenced_files', 'referencedFiles', 'files'])
    : [];
  const referencedDiffs = enrichment
    ? readStringArrayByKeys(enrichment, ['referenced_diffs', 'referencedDiffs', 'diffs'])
    : [];
  const changedFiles = readRecordKeys(parsed['changes']);
  if (referencedFiles.length === 0 && changedFiles.length > 0) {
    referencedFiles.push(...changedFiles);
  }
  const rawEvent = readRawEventRecord(parsed, permissionRoot, permissionRequestRecord);

  return {
    responseType: AgentRequestPermissionPayloadResponseTypeEnum.AgentRequestPermissionV1,
    permissionRequest: {
      id,
      runId,
      permissionType,
      sessionId,
      agentId,
      agentType,
      timestamp,
      idempotencyToken,
      reason,
      agentIntent,
      referencedFiles,
      referencedDiffs,
    },
    rawEvent,
    enrichmentMetadata: enrichment,
  };
};

// -- Permission resolved parsing --

interface PermissionResolvedResponse {
  responseType: 'agent_permission_resolved_v1';
  requestId: string;
  resolution: string;
  reason: string | null;
}

const tryParsePermissionResolvedResponse = (text: string): PermissionResolvedResponse | null => {
  const parsed = parseJsonRecord(text);
  if (!parsed) return null;
  if (parsed['responseType'] !== 'agent_permission_resolved_v1') return null;
  const requestId = readStringByKeys(parsed, ['request_id', 'requestId']);
  if (!requestId) return null;
  const resolution = readStringByKeys(parsed, ['resolution']) ?? 'cancelled';
  const reason = readStringByKeys(parsed, ['reason']);
  return { responseType: 'agent_permission_resolved_v1', requestId, resolution, reason };
};

// -- Text normalization --

const normalizeTextForDisplay = (text: string): string => text.trim();

// -- Completion detection --
//
// Text patterns alone are not reliable enough — a single match could fire on
// mid-conversation output ("here's a summary of what I found so far"). We
// require at least MIN_TEXT_PATTERN_MATCHES distinct pattern hits before
// treating text-only content as a completion signal.

const COMPLETION_TEXT_PATTERNS = [
  /here(?:'s| is) (?:a )?(?:summary|what (?:was|i) (?:done|accomplished|implemented|changed))/i,
  /(?:implementation|task|work|changes?) (?:is |are )?(?:complete|done|finished)/i,
  /(?:all|the) (?:changes|updates|modifications) (?:have been|were) (?:applied|made|implemented)/i,
  /i(?:'ve| have) (?:completed|finished|implemented|made all)/i,
];

const MIN_TEXT_PATTERN_MATCHES = 2;

const detectsAgentCompletion = (opts: {
  text: string;
  actionHint?: string | undefined;
  structuredResponseType?: string | undefined;
}): boolean => {
  if (opts.actionHint === 'task_complete') return true;
  if (opts.structuredResponseType === 'final_assessment_v2') return true;
  const matchCount = COMPLETION_TEXT_PATTERNS.filter((pattern) => pattern.test(opts.text)).length;
  return matchCount >= MIN_TEXT_PATTERN_MATCHES;
};

const tryParseDailySessionResponse = (text: string): DailySessionParsedResponse | null => {
  const parsed = parseJsonRecord(text);
  if (!parsed) return null;

  const response = readNonEmptyString(parsed['response']);
  const conversationTitle = readNonEmptyString(parsed['conversationTitle']);
  if (!response || !conversationTitle) return null;

  return {
    response,
    conversationTitle,
    ...(Array.isArray(parsed['suggestedActions'])
      ? { suggestedActions: parsed['suggestedActions'] as string[] }
      : {}),
    ...(Array.isArray(parsed['relatedEntities'])
      ? { relatedEntities: parsed['relatedEntities'] as Array<Record<string, unknown>> }
      : {}),
    ...(Array.isArray(parsed['influences'])
      ? { influences: parsed['influences'] as Array<Record<string, unknown>> }
      : {}),
  };
};

const tryParseTaskRefinerResponse = (text: string): string | null => {
  const parsed = parseJsonRecord(text);
  if (!parsed) return null;
  return readNonEmptyString(parsed['response']);
};

const tryParseFeatureRefinerResponse = (text: string): string | null => {
  const parsed = parseJsonRecord(text);
  if (!parsed) return null;
  return readNonEmptyString(parsed['response']);
};

const tryParsePlanShapingFeatureSyncIterateResponse = (text: string) => {
  const parsed = parsePlanShapingFeatureSyncIterateResponseFromText(text);
  return parsed.ok ? parsed.value : null;
};

const tryParseKnownStructuredResponse = (
  text: string,
  expectedResponseTypes: readonly StructuredResponseType[] = DEFAULT_STRUCTURED_RESPONSE_TYPES,
): KnownStructuredResponse | null => {
  if (expectedResponseTypes.includes('final_assessment_v2')) {
    const finalAssessmentParsed = parseFinalAssessmentResponseFromText(text);
    if (finalAssessmentParsed.ok) {
      return {
        responseType: 'final_assessment_v2',
        parsed: finalAssessmentParsed.value,
      };
    }
  }

  if (expectedResponseTypes.includes('startup_plan_v1')) {
    const startupPlanParsed = parseStartupSessionPlanResponseFromText(text);
    if (startupPlanParsed.ok) {
      return {
        responseType: 'startup_plan_v1',
        parsed: startupPlanParsed.value,
      };
    }
  }

  return null;
};

const toStructuredResponseUiMarker = (response: KnownStructuredResponse): UIElement => {
  if (response.responseType === 'startup_plan_v1') {
    return {
      id: randomUUID(),
      ...STRUCTURED_UI_ELEMENT_TEMPLATES.startup_plan_v1,
      payload: toCodingPromptStartupPlanPayload(response.parsed),
    };
  }

  return {
    id: randomUUID(),
    ...STRUCTURED_UI_ELEMENT_TEMPLATES.final_assessment_v2,
    payload: response.parsed as unknown as UIElementPayload,
  };
};

const toStructuredResponseSummaryText = (response: KnownStructuredResponse): string => {
  if (response.responseType === 'startup_plan_v1') {
    return renderStartupPlanSummary(response.parsed);
  }

  if (response.responseType === 'final_assessment_v2') {
    return 'Final Assessment';
  }

  return 'Structured response';
};

export interface MapAgentOutputInput {
  text: string;
  timestamp: string;
  projectId: string;
  conversationId: string;
  parentMessageId?: string;
  triggerNotification?: boolean;
  actionHint?: string;
  /**
   * Legacy structured response variants this caller explicitly permits. The
   * default preserves the mapper's generic behavior for existing callers;
   * handler-owned callers should pass the active handler's allowlist so a
   * Coding Plan acknowledgement cannot regain startup-plan UI behavior.
   */
  expectedResponseTypes?: readonly StructuredResponseType[];
}

interface MapUserPromptInput {
  prompt: string;
  timestamp: string;
  projectId: string;
  conversationId: string;
  userId: string;
  parentMessageId?: string;
}

export interface MapAgentOutputResult {
  message: CreateSystemMessage;
  isStartupPlan: boolean;
  isDailySession: boolean;
  dailySessionResponseText?: string;
  ragEnabled: boolean;
}

export const toPermissionRequestUiMarker = (
  response: AgentRequestPermissionPayload,
): UIElement => ({
  id: `${UI_ELEMENT_IDS.permission_request_v1}:${response.permissionRequest.id}`,
  type: ExtendedUIFieldType.AgentRequestPermission,
  label: 'Permission Request',
  submitText: 'Approve',
  payload: response as unknown as UIElementPayload,
});

export const toPermissionRequestSummaryText = (response: AgentRequestPermissionPayload): string => {
  const parts = [`Permission Request: ${response.permissionRequest.permissionType}`];
  if (response.permissionRequest.reason) {
    parts.push(`Reason: ${response.permissionRequest.reason}`);
  }
  if (response.permissionRequest.agentIntent) {
    parts.push(`Agent intent: ${response.permissionRequest.agentIntent}`);
  }
  if (response.permissionRequest.referencedFiles.length > 0) {
    parts.push(`Referenced files: ${response.permissionRequest.referencedFiles.join(', ')}`);
  }
  return parts.join('\n');
};

const mapDailySessionResponse = (
  parsed: DailySessionParsedResponse,
  input: MapAgentOutputInput,
): MapAgentOutputResult => {
  const uiElements: UIElement[] = [
    {
      id: nextUiElementId('daily-session-response'),
      type: ExtendedUIFieldType.Textarea,
      label: 'Continue the conversation',
      multiline: true,
      required: false,
    },
  ];

  const systemData: SystemMessageData = {
    type: SystemMessageDataTypeEnum.Agent,
    title: 'Daily Session',
    response: parsed.response,
    detectedIntent: 'daily_session',
    intentConfidence: 1.0,
    ragEnabled: false,
    uiElements,
  };

  const message: CreateSystemMessage = {
    projectId: input.projectId,
    type: MessageType.System,
    status: MessageStatus.Open,
    conversationId: input.conversationId,
    data: systemData,
    createdAt: input.timestamp,
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
  };

  return {
    message,
    isStartupPlan: false,
    isDailySession: true,
    dailySessionResponseText: parsed.response,
    ragEnabled: false,
  };
};

const mapTaskRefinerResponse = (
  response: string,
  input: MapAgentOutputInput,
): MapAgentOutputResult => {
  const uiElements: UIElement[] = [
    {
      id: nextUiElementId('task-refiner-response'),
      type: ExtendedUIFieldType.Textarea,
      label: 'Continue the conversation',
      multiline: true,
      required: false,
    },
  ];

  const systemData: SystemMessageData = {
    type: SystemMessageDataTypeEnum.Agent,
    title: 'Task Refinement',
    response,
    detectedIntent: 'task_refiner',
    intentConfidence: 1.0,
    ragEnabled: false,
    uiElements,
  };

  const message: CreateSystemMessage = {
    projectId: input.projectId,
    type: MessageType.System,
    status: MessageStatus.Open,
    conversationId: input.conversationId,
    data: systemData,
    createdAt: input.timestamp,
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
  };

  return {
    message,
    isStartupPlan: false,
    isDailySession: false,
    ragEnabled: false,
  };
};

const mapFeatureRefinerResponse = (
  response: string,
  input: MapAgentOutputInput,
): MapAgentOutputResult => {
  const uiElements: UIElement[] = [
    {
      id: nextUiElementId('feature-refiner-response'),
      type: ExtendedUIFieldType.Textarea,
      label: 'Continue the conversation',
      multiline: true,
      required: false,
    },
  ];

  const systemData: SystemMessageData = {
    type: SystemMessageDataTypeEnum.Agent,
    title: 'Feature Refinement',
    response,
    detectedIntent: 'feature_refiner',
    intentConfidence: 1.0,
    ragEnabled: false,
    uiElements,
  };

  const message: CreateSystemMessage = {
    projectId: input.projectId,
    type: MessageType.System,
    status: MessageStatus.Open,
    conversationId: input.conversationId,
    data: systemData,
    createdAt: input.timestamp,
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
  };

  return {
    message,
    isStartupPlan: false,
    isDailySession: false,
    ragEnabled: false,
  };
};

const mapPlanShapingFeatureSyncIterateResponse = (
  response: PlanShapingFeatureSyncIterateResponse,
  input: MapAgentOutputInput,
): MapAgentOutputResult => {
  const uiElements: UIElement[] = [
    {
      id: nextUiElementId('plan-shaping-feature-sync-review'),
      type: ExtendedUIFieldType.PlanShapingFeatureSyncReview,
      label: 'Feature Sync Review',
      payload: {
        discrepancies: response.discrepancies,
        proposals: response.proposals,
      } as unknown as UIElementPayload,
    },
  ];

  const systemData: QuestionsSystemMessageData = {
    type: SystemMessageDataTypeEnum.Questions,
    title: 'Feature Sync Review',
    response: 'Review the flagged items and provide feedback',
    detectedIntent: 'plan_shaping_feature_sync_iterate',
    intentConfidence: 1.0,
    ragEnabled: false,
    uiElements,
  };

  const message: CreateSystemMessage = {
    projectId: input.projectId,
    type: MessageType.System,
    status: MessageStatus.Open,
    conversationId: input.conversationId,
    data: systemData,
    createdAt: input.timestamp,
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
  };

  return {
    message,
    isStartupPlan: false,
    isDailySession: false,
    ragEnabled: false,
  };
};

export const mapAgentOutputToSystemMessage = (
  input: MapAgentOutputInput,
): MapAgentOutputResult | null => {
  const normalizedText = normalizeTextForDisplay(input.text);
  if (normalizedText.length === 0) {
    return null;
  }

  // Daily session responses are handled separately — they should never
  // trigger completion detection or get the agent_complete UI element.
  const dailySessionResponse = tryParseDailySessionResponse(input.text);
  if (dailySessionResponse) {
    return mapDailySessionResponse(dailySessionResponse, input);
  }

  // Task refiner responses bypass completion detection and the agent_complete element.
  const taskRefinerResponse = tryParseTaskRefinerResponse(input.text);
  if (taskRefinerResponse) {
    return mapTaskRefinerResponse(taskRefinerResponse, input);
  }

  // Feature refiner responses bypass completion detection and the agent_complete element.
  const featureRefinerResponse = tryParseFeatureRefinerResponse(input.text);
  if (featureRefinerResponse) {
    return mapFeatureRefinerResponse(featureRefinerResponse, input);
  }

  // Plan-shaping feature-sync iterate responses bypass the generic structured tail
  // (which returns status Completed) and instead return an Open Questions message
  // that parks for user reply.
  const planShapingFeatureSyncIterateResponse = tryParsePlanShapingFeatureSyncIterateResponse(
    input.text,
  );
  if (planShapingFeatureSyncIterateResponse) {
    return mapPlanShapingFeatureSyncIterateResponse(planShapingFeatureSyncIterateResponse, input);
  }

  const permissionResolvedResponse = tryParsePermissionResolvedResponse(input.text);
  const permissionRequestResponse = permissionResolvedResponse
    ? null
    : tryParsePermissionRequestResponse(input.text);
  const structuredResponse = tryParseKnownStructuredResponse(
    input.text,
    input.expectedResponseTypes,
  );
  const isStartupPlan = structuredResponse?.responseType === 'startup_plan_v1';
  const isPermissionRequest = permissionRequestResponse !== null;
  const isPermissionResolved = permissionResolvedResponse !== null;

  const isAgentComplete = detectsAgentCompletion({
    text: input.text,
    actionHint: input.actionHint,
    structuredResponseType: structuredResponse?.responseType,
  });

  const uiElements: UIElement[] = [];
  if (structuredResponse) {
    uiElements.push(toStructuredResponseUiMarker(structuredResponse));
  } else if (isPermissionRequest) {
    uiElements.push(toPermissionRequestUiMarker(permissionRequestResponse));
  } else if (isPermissionResolved) {
    const resolvedMarker: UIElement = {
      id: `${UI_ELEMENT_IDS.permission_request_v1}:${permissionResolvedResponse.requestId}:resolved`,
      type: ExtendedUIFieldType.AgentRequestPermission,
      label: 'Permission Request Cancelled',
    };
    Reflect.set(resolvedMarker, 'payload', {
      responseType: 'agent_permission_resolved_v1',
      requestId: permissionResolvedResponse.requestId,
      resolution: permissionResolvedResponse.resolution,
      reason: permissionResolvedResponse.reason,
    });
    uiElements.push(resolvedMarker);
  } else if (isAgentComplete) {
    uiElements.push(AGENT_COMPLETE_UI_ELEMENT);
  }

  const hasStructuredUi =
    structuredResponse !== null || isPermissionRequest || isPermissionResolved || isAgentComplete;

  const systemData: SystemMessageData = {
    type: hasStructuredUi ? SystemMessageDataTypeEnum.Questions : SystemMessageDataTypeEnum.Agent,
    title: isPermissionRequest
      ? 'Permission Request'
      : isPermissionResolved
        ? 'Permission Request Cancelled'
        : 'Execution Update',
    response: permissionRequestResponse
      ? toPermissionRequestSummaryText(permissionRequestResponse)
      : isPermissionResolved
        ? `Permission request ${permissionResolvedResponse.requestId} was cancelled.${permissionResolvedResponse.reason ? ` Reason: ${permissionResolvedResponse.reason}` : ''}`
        : structuredResponse
          ? toStructuredResponseSummaryText(structuredResponse)
          : normalizedText,
    detectedIntent: 'agent_response',
    intentConfidence: 1.0,
    ragEnabled: false,
    ...(uiElements.length > 0 ? { uiElements } : {}),
    ...(input.triggerNotification ? { triggerNotification: true } : {}),
    ...(input.actionHint
      ? { actionHint: input.actionHint as SystemMessageDataActionHintEnum }
      : {}),
  };

  const message: CreateSystemMessage = {
    projectId: input.projectId,
    type: MessageType.System,
    status: isStartupPlan || isPermissionRequest ? MessageStatus.Open : MessageStatus.Completed,
    conversationId: input.conversationId,
    data: systemData,
    createdAt: input.timestamp,
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
  };

  return {
    message,
    isStartupPlan,
    isDailySession: false,
    ragEnabled: false,
  };
};

const mapUserPromptToMessage = (input: MapUserPromptInput): CreateUserMessage | null => {
  const trimmed = input.prompt.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const userData: UserMessageData = {
    comment: trimmed,
  };

  return {
    projectId: input.projectId,
    type: MessageType.User,
    userId: input.userId,
    status: MessageStatus.Completed,
    conversationId: input.conversationId,
    data: userData,
    createdAt: input.timestamp,
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
  };
};

interface MapMergedProcessResultInput {
  responseType: string;
  payload: CodingPromptMergedFinalAssessmentPayload;
  timestamp: string;
  projectId: string;
  conversationId: string;
  parentMessageId?: string;
}

const mapMergedProcessResultToSystemMessage = (
  input: MapMergedProcessResultInput,
): CreateSystemMessage | null => {
  if (input.responseType !== 'merged_final_assessment_v1') {
    return null;
  }

  const uiElement: UIElement = {
    id: randomUUID(),
    type: ExtendedUIFieldType.CodingPromptMergedFinalAssessment,
    label: 'Final Assessment',
    payload: input.payload,
  };

  const systemData: QuestionsSystemMessageData = {
    type: SystemMessageDataTypeEnum.Questions,
    title: 'Final Assessment',
    response: "We've generated a synchronization report with Hey Hey",
    detectedIntent: 'merged_final_assessment',
    intentConfidence: 1.0,
    uiElements: [uiElement],
  };

  return {
    projectId: input.projectId,
    type: MessageType.System,
    status: MessageStatus.Completed,
    conversationId: input.conversationId,
    data: systemData,
    createdAt: input.timestamp,
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
  };
};
