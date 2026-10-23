import type {
  CoordinateTaskMonitorWorkEffect,
  EvaluateTaskMonitorSettledRunEffect,
} from './effects';
import type { TaskMonitorCoordinatorValidationFailure } from '../../../shared/agent-bridge-contract/generated/api';
import type {
  TaskMonitorLaunchConfig,
  TaskMonitorPlanGuidance,
} from '../../../shared/agent-bridge-contract/generated/api';
import type { ReportType } from '../../../shared/api/generated/api';
import type { RunWorktreeCollision } from '../../run-scope';
import type { TaskMonitorCoordinationCause } from '../task-monitor-coordination';

type TaskMonitorSessionMethod = 'plan' | 'open' | 'quick';

export interface TaskMonitorWorktree {
  readonly enabled: boolean;
  readonly branch?: string | undefined;
}

export interface TaskMonitorRequestedLaunchConfig {
  readonly taskId: string;
  readonly method: TaskMonitorLaunchConfig['method'];
  readonly provider: TaskMonitorLaunchConfig['provider'];
  readonly model: string;
  readonly reasoningEffort: TaskMonitorLaunchConfig['reasoningEffort'];
  readonly fastMode?: TaskMonitorLaunchConfig['fastMode'];
  readonly worktree?: TaskMonitorWorktree | undefined;
}

export interface TaskMonitorExecutionNode {
  readonly taskId: string;
  readonly dependsOnTaskIds: readonly string[];
  readonly method: TaskMonitorSessionMethod;
  readonly provider: TaskMonitorLaunchConfig['provider'];
  readonly model: string;
  readonly reasoningEffort: TaskMonitorLaunchConfig['reasoningEffort'];
  readonly fastMode?: TaskMonitorLaunchConfig['fastMode'];
  readonly agentSessionId: string | null;
}

export interface TaskMonitorTerminalPolicy {
  readonly mode: 'AGENT_DECIDES' | 'REQUIRE_REVIEW';
}

export interface TaskMonitorReviewRequest {
  readonly requestId: string;
  readonly coordinatorRunId: string;
  readonly agentSessionId: string;
  readonly rationale: string;
  readonly failureContext: string | null;
}

export type TaskMonitorPlanGuidanceProjection = TaskMonitorPlanGuidance;
export type TaskMonitorLaunchFailure = RunWorktreeCollision;

export interface TaskMonitorLaunchDeclaration {
  readonly authorityCommandId?: string | undefined;
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly taskType: string;
  readonly taskDescription: string;
  readonly taskAcceptanceCriteria: string | null;
  readonly cursor: number;
  readonly method: TaskMonitorSessionMethod;
  readonly provider: TaskMonitorLaunchConfig['provider'];
  readonly model: string;
  readonly reasoningEffort: TaskMonitorLaunchConfig['reasoningEffort'];
  readonly fastMode?: TaskMonitorLaunchConfig['fastMode'];
  readonly serviceIds: readonly string[];
  readonly worktree?: TaskMonitorWorktree | undefined;
  readonly userGuidance: string | null;
  readonly planGuidance: TaskMonitorPlanGuidanceProjection | null;
  readonly executionOrder: readonly string[];
  readonly dependsOnTaskIds: readonly string[];
  readonly terminalPolicy: TaskMonitorTerminalPolicy;
}

export interface TaskMonitorRetryableLaunch {
  readonly taskId: string;
  readonly cursor: number;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly failedOperation: 'RUN_START';
  readonly failureReason: string;
  readonly failure?: TaskMonitorLaunchFailure | undefined;
}

export type TaskMonitorHumanDecisionResolution = 'APPROVE' | 'DENY';

export interface TaskMonitorHumanDecisionEvidence {
  readonly userId: string;
  readonly authenticatedAt: string;
}

export interface TaskMonitorInterventionDecision {
  readonly resolution: TaskMonitorHumanDecisionResolution;
  readonly decidedAt: string;
  readonly human: TaskMonitorHumanDecisionEvidence;
}

export interface TaskMonitorPendingIntervention {
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly providerSessionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decision: TaskMonitorInterventionDecision | null;
  readonly applicationFailure: string | null;
}

export interface TaskMonitorSettledRun {
  readonly runId: string;
  readonly agentSessionId: string;
  readonly settledAt: string;
  readonly outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly turnId: string;
  readonly promptType: string;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  readonly completedAssistantMessageId: string | null;
  readonly reports: readonly { readonly reportId: string; readonly reportType: ReportType }[];
  readonly reviewRequestId: string | null;
}

type TaskMonitorInputState = 'WAITING_FOR_INPUT' | 'READING_INPUT' | 'RESPONDING_INPUT';

interface TaskMonitorConversationInputClaim {
  readonly messageId: string;
  readonly effectId: string;
  readonly runId: string | null;
  readonly turnId: string | null;
  readonly assistantMessageId: string | null;
}

export interface TaskMonitorConversationInputContext {
  readonly queuedMessageIds: readonly string[];
  readonly active: TaskMonitorConversationInputClaim | null;
}

interface TaskMonitorCoordinatorRecovery {
  readonly evaluation: CoordinateTaskMonitorWorkEffect | EvaluateTaskMonitorSettledRunEffect;
  readonly correctionAttempt: number;
  readonly failure: TaskMonitorCoordinatorValidationFailure;
  readonly pendingCorrection: boolean;
  readonly requestId: string;
  readonly requestMessageId: string | null;
  readonly conversationId: string | null;
  readonly deliveryFailure: string | null;
}

export interface TaskMonitorMachineContext {
  readonly taskMonitorId: string;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly authorityCommandId?: string | null | undefined;
  readonly coordinationCause?: TaskMonitorCoordinationCause | null | undefined;
  readonly coordinationCorrelationId?: string | null | undefined;
  readonly requestedLaunchConfig: TaskMonitorRequestedLaunchConfig | null;
  readonly executionPlan: readonly TaskMonitorExecutionNode[];
  readonly cursor: number | null;
  readonly selectedTaskId: string | null;
  readonly userGuidance: string | null;
  readonly worktree: TaskMonitorWorktree | null;
  readonly terminalPolicy: TaskMonitorTerminalPolicy | null;
  readonly launch: TaskMonitorLaunchDeclaration | null;
  readonly agentSessionId: string | null;
  readonly activeRunAgentSessionId: string | null;
  readonly conversationId: string | null;
  readonly retryableLaunch?: TaskMonitorRetryableLaunch | null | undefined;
  readonly coordinatorConversationId: string | null;
  readonly pendingIntervention: TaskMonitorPendingIntervention | null;
  readonly settledRun: TaskMonitorSettledRun | null;
  readonly reviewRequest: TaskMonitorReviewRequest | null;
  readonly input: TaskMonitorConversationInputContext;
  readonly failureReason: string | null;
  readonly coordinatorRecovery?: TaskMonitorCoordinatorRecovery | null | undefined;
}
