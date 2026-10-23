import {
  AgentSystemMessageData,
  AgentTrigger,
  AgentTriggerUserMessage,
  AnalysisSystemMessageData,
  ErrorSystemMessageData,
  FeatureListSystemMessageData,
  GenerationSystemMessageData,
  IntegrationsSystemMessageData,
  QuestionsSystemMessageData,
  SystemMessageData,
  SystemMessageResponseType,
  UserMessageAgentInput,
  UserMessageDataTaskMonitor,
} from '../generated';

export const isQuestionSystemMessageData = (
  s: SystemMessageData,
): s is QuestionsSystemMessageData =>
  s.type === SystemMessageResponseType.Questions;

/**
 * Narrow `SystemMessageData` to the `AGENT` variant so read sites can reach
 * the AGENT-only `completesExternalAgentNode` field without bag casts. Keyed
 * on the `AGENT` discriminator, mirroring `extractExternalAgentCompletion`'s
 * gate.
 */
export const isAgentSystemMessageData = (
  s: SystemMessageData,
): s is AgentSystemMessageData => s.type === SystemMessageResponseType.Agent;

/**
 * Narrow an `AgentTrigger` union value to the user-message follow-up variant
 * via its sentinel `promptType` discriminator, so callers can read the
 * spec-canonical `payload.handlerPromptType` without inline shape casts.
 */
export const isAgentTriggerUserMessage = (
  t: AgentTrigger | undefined,
): t is AgentTriggerUserMessage =>
  !!t && t.promptType === AgentTriggerUserMessage.PromptTypeEnum.UserMessage;

/**
 * Read the `promptType` routing key off a typed `agentInput` arm, or `null`
 * when the envelope is absent.
 * Reads the raw discriminator independent of `workflowName` so the inbound
 * validator can still detect an illegal both-set submission; returns a plain
 * string because the per-arm `PromptTypeEnum` literals share no single exported
 * union and dispatch sites treat the value as the CLI `LocalPromptType` key.
 */
export const getAgentInputPromptType = (
  a: UserMessageAgentInput | undefined,
): string | null => {
  if (!a) return null;
  const promptType = (a as { promptType?: unknown }).promptType;
  return typeof promptType === 'string' && promptType.length > 0
    ? promptType
    : null;
};

export const isTaskMonitorAgentInput = (
  a: UserMessageAgentInput | undefined,
): a is UserMessageDataTaskMonitor =>
  getAgentInputPromptType(a) ===
  UserMessageDataTaskMonitor.PromptTypeEnum.TaskMonitor;

export const isAgentsSystemMessageData = (
  s: SystemMessageData,
): s is QuestionsSystemMessageData =>
  s.type === SystemMessageResponseType.Agent;

export const isGenerationSystemMessageData = (
  s: SystemMessageData,
): s is GenerationSystemMessageData =>
  s.type === SystemMessageResponseType.Initiatives ||
  s.type === SystemMessageResponseType.ArtifactsGeneration ||
  s.type === 'FEATURE_LIST';

export const isAnalysisSystemMessageData = (
  s: SystemMessageData,
): s is AnalysisSystemMessageData =>
  s.type === SystemMessageResponseType.Analysis;

export const isIntegrationsSystemMessageData = (
  s: SystemMessageData,
): s is IntegrationsSystemMessageData =>
  s.type === SystemMessageResponseType.Integrations;

export const isErrorSystemMessageData = (
  s: SystemMessageData,
): s is ErrorSystemMessageData => s.type === SystemMessageResponseType.Error;

type UIElementsMessageData =
  | AnalysisSystemMessageData
  | FeatureListSystemMessageData
  | GenerationSystemMessageData
  | QuestionsSystemMessageData
  | IntegrationsSystemMessageData;

export const hasUiElements = (
  s: SystemMessageData | null | undefined,
): s is UIElementsMessageData & {
  uiElements: NonNullable<UIElementsMessageData['uiElements']>;
} => {
  if (!s) return false;

  return Array.isArray(s.uiElements) && s.uiElements.filter(Boolean).length > 0;
};
