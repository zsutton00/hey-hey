import type {
  AgentSessionConfig,
  StartRunPromptPayloadReasoningEffortEnum,
  LocalAgentSearchEntityType,
  FeatureSyncDiscrepancy,
  PlanShapingFeatureSyncIteratePromptPayload,
  LocalPromptStartupInput,
  LocalPromptTaskNeighborhoodInput,
  LocalPromptTaskNeighborhoodTaskInput,
  LocalRun as GeneratedLocalRun,
  LocalRunEvent as GeneratedLocalRunEvent,
  LocalRunPromptResult as GeneratedLocalRunPromptResult,
  LocalRunScope as GeneratedLocalRunScope,
  LocalRunWorkspaceLayout as GeneratedLocalRunWorkspaceLayout,
  RunContextMetadata,
  RunCreatePayload,
  RunReferences,
  RunAttachmentReference,
  StagedBrowserTabReference,
  AgentSkillSelection,
  ContextData,
  CliReadProviderSessionUsageCost,
} from './generated/api';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface LocalPendingRunContext {
  projectId: string;
  serviceIds?: string[];
  launchServiceId?: string;
  planId?: string;
  stepId?: string;
  provider?: 'claude' | 'codex' | 'opencode';
}

export interface LocalCreateRunRequest {
  context: LocalPendingRunContext;
  contextMetadata: RunContextMetadata;
  scope?: LocalRunScope;
  conversationId: string;
  worktree?: LocalWorktreeConfig;
  payload?: RunCreatePayload;
  triggersAgent?: boolean;
  attachments: RunAttachmentReference[];
  /** A tab the user opened before the Run existed, which the new Run adopts; null when none. */
  stagedBrowserTab: StagedBrowserTabReference | null;
  references?: RunReferences;
  model?: string;
  reasoningEffort?: StartRunPromptPayloadReasoningEffortEnum;
  fastMode?: boolean;
  /** Pathless provider Skill identity; the provider resolves it inside the Run workspace. */
  skillSelection?: AgentSkillSelection;
  config?: AgentSessionConfig | null;
}

export interface LocalWorktreeConfig {
  enabled: boolean;
  branch?: string;
}

type LocalRun = GeneratedLocalRun;
export type LocalRunDiffFilePatch = {
  serviceId: string;
  repoPath: string;
  filePath: string;
  diff: string;
  preContent: string | null;
  postContent: string | null;
};
export type LocalDiffFilePatch = {
  filePath: string;
  diff: string;
  preContent: string | null;
  postContent: string | null;
};
export type LocalRunPromptPayload = Extract<RunCreatePayload, { promptType: 'free_form' }>;
type LocalRunPromptResult = GeneratedLocalRunPromptResult;
type LocalRunEvent = GeneratedLocalRunEvent;
type LocalRunScope = GeneratedLocalRunScope;
type LocalRunWorkspaceLayout = GeneratedLocalRunWorkspaceLayout;
type LocalRunReferences = RunReferences;

export type LocalContextData = ContextData;

export interface LocalToolUsageEntry {
  toolName: string;
  toolUseId: string;
  timestamp: string;
  input?: object;
}

type LocalProviderSessionUsageCost = CliReadProviderSessionUsageCost;

type LocalCreateRunResponse =
  | { status: 'started'; run: LocalRun }
  | { status: 'repo-required'; serviceIds: string[]; launchServiceId: string };

interface LocalPromptAgentWorkflowContext {
  organizationId: string;
  projectId: string;
  agentSessionId: string | null;
  taskId?: string;
  designDocId?: string;
  initiativeId?: string;
  planId?: string;
  serviceIds?: string[];
  launchServiceId?: string;
}

type LocalPromptFinalAssessmentRelatedTaskInput = LocalPromptTaskNeighborhoodTaskInput;
export type LocalPromptFinalAssessmentTaskNeighborhoodInput = Pick<
  LocalPromptTaskNeighborhoodInput,
  'parentTasks' | 'childTasks'
>;

export interface LocalPromptStartupDiscrepancyContextItem {
  discrepancyIndex: number;
  sourceRef: { sourceType: string; sourceId: string };
  sourceField?: string;
  sourceExcerpt: string;
  reasoning: string;
  discrepancyText: string;
  severity: 'low' | 'medium' | 'high';
  disposition?: 'acknowledged' | 'blocker';
  dispositionNote?: string;
  sourceEventMetadata?: {
    startupPlanResponseEventSeq?: number;
    startupPlanReviewActionEventSeq?: number;
    sourceType: string;
    sourceId: string;
  };
}

export interface LocalFinalAssessmentPromptPayload {
  context: LocalPromptAgentWorkflowContext;
  /** @deprecated Compatibility only; canonical context comes from the Run. */
  startupInput?: LocalPromptStartupInput;
  startupDiscrepancyContext?: LocalPromptStartupDiscrepancyContextItem[];
  taskNeighborhood: LocalPromptFinalAssessmentTaskNeighborhoodInput;
  executionSummary: string;
  userMessage?: string;
}

export interface LocalVerificationPlanPromptPayload {
  context: LocalPromptAgentWorkflowContext;
  /** @deprecated Compatibility only; canonical context comes from the Run. */
  startupInput?: LocalPromptStartupInput;
  executionSummary: string;
  userMessage?: string;
}

export interface LocalChildTaskUpdatesPromptPayload {
  completedTask: {
    id: string;
    title?: string;
    description: string;
    acceptanceCriteria?: string;
  };
  finalAssessment: {
    taskAssessment: JsonValue;
    implementationNotes?: string;
  };
  childTasks: LocalPromptFinalAssessmentRelatedTaskInput[];
  designDoc?: { id?: string; title?: string; sections?: { [key: string]: string } };
  initiative?: { id?: string; title?: string; description?: string };
}

export interface LocalCodingFreeformPromptPayload {
  userMessage: string;
}

export interface LocalCommitPromptPayload {
  changedFiles?: string[];
  taskId?: string;
  codingSessionId?: string;
  userMessage?: string;
}

export interface LocalCodeReviewPromptPayload {
  userMessage?: string;
}

export type LocalImplementPromptPayload = import('./generated/api').ImplementPromptPayload;

export interface LocalFeatureTreeConversationPromptPayload {
  projectId: string;
  userMessage?: string;
}

export interface LocalRollupProposalPromptPayload {
  payloadVersion: number;
  taskId: string;
}

interface LocalResearchOutput {
  frame: { [key: string]: JsonValue };
  analysis: string;
  summary: string;
  provenance: { [key: string]: JsonValue };
  updates: LocalResearchUpdate[];
}

export const LocalResearchUpdateOperation = {
  Add: 'add',
  Remove: 'remove',
  Update: 'update',
} as const;

export type LocalResearchUpdateOperation =
  (typeof LocalResearchUpdateOperation)[keyof typeof LocalResearchUpdateOperation];

export interface LocalResearchUpdateTarget {
  entityType: LocalAgentSearchEntityType;
  entityId: string;
  title: string;
}

export interface LocalResearchUpdate {
  type: LocalResearchUpdateOperation;
  targets: LocalResearchUpdateTarget[];
  description: string;
  reason: string;
}

export interface LocalFeatureSyncAnalyzePromptPayload {
  taskId: string;
  userMessage?: string;
  launchPlanId?: string;
  launchStepId?: string;
  launchStageId?: string;
}

export interface LocalFeatureSyncIteratePromptPayload {
  discrepancies: FeatureSyncDiscrepancy[];
  userMessage?: string;
}

export interface LocalPlanShapingFeatureSyncAnalyzePromptPayload {
  planId: string;
  designDocId: string;
  userMessage?: string;
}

export type LocalPlanShapingFeatureSyncIteratePromptPayload =
  PlanShapingFeatureSyncIteratePromptPayload;

export interface LocalPlanShapingFeatureSyncDiscussPromptPayload {
  planId: string;
  designDocId: string;
  discrepancies: FeatureSyncDiscrepancy[];
  userMessage: string;
}

interface LocalTaskMonitorPromptPayload {
  taskId: string;
  userMessage?: string;
}

/** Internal-only ordinary conversation input for the existing Task Monitor coordinator Run. */
export interface TaskMonitorConversationPromptPayload {
  promptType: 'task_monitor';
  mode: 'CONVERSATION';
  taskMonitorId: string;
  conversationId: string;
  sourceMessageId: string;
  userMessage: string;
}
