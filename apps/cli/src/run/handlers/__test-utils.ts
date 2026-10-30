/**
 * Shared test factories for handler tests.
 */

import { vi } from 'vitest';
import { stampCreateBody, stampUpdateData } from '../message-poster';
import type {
  HandlerDeps,
  MessagePosterCreateOutOfBandArgs,
  MessageStamp,
  PendingDiff,
} from '../types';
import { Run, type RunCollaborators } from '../run';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunnerPicker,
} from '../run.test-support';
import { Turn } from '../../turn/turn';
import type { TurnPlatformMcpProxy } from '../../agents/platform-mcp-proxy/turn-proxy';
import type { PromptTypeHandler } from '../../agents/prompt-type-handler';
import {
  createPromptTypeHandlerTestDeps,
  createPromptTypeHandlerTestRunStore,
} from '../../agents/prompt-type-handler.test-support';
import type { AgenticSession, PreviousProviderSession, RunMemo } from '../../session/types';
import type {
  CreateSystemMessage,
  CreateUserMessage,
  UpdateMessageDto,
} from '../../shared/api/index';

/**
 * Mock poster that applies the real seam's stamping logic in-place so test
 * assertions on `data['providerSessionId']` / `data['promptHandler']` see
 * the stamped payload after callers route through the seam.
 */
export const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn(async (args: MessagePosterCreateOutOfBandArgs) => {
      args.dto = stampCreateBody(args.dto, args.stamp);
      return 'oob-msg-1';
    }),
    update: vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _messageId: string,
        data: UpdateMessageDto,
        stamp: MessageStamp | null,
      ) => {
        Object.assign(data, stampUpdateData(data, stamp));
      },
    ),
    complete: vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _messageId: string,
        data: UpdateMessageDto,
        stamp: MessageStamp | null,
      ) => {
        Object.assign(data, stampUpdateData(data, stamp));
      },
    ),
  });

/**
 * Build HandlerDeps for a test. Handlers no longer mutate the
 * processingMessageId — that field is Turn-owned and written only by
 * Turn.begin()/Turn.end() — so this factory no longer plumbs a setter.
 */
export const makeDeps = (poster?: HandlerDeps['poster']): HandlerDeps => {
  const p = poster ?? makePoster();
  return {
    poster: p,
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as unknown as HandlerDeps['logger'],
  };
};

export const makeTestRun = (
  overrides?: Partial<Run> & {
    persistenceStore?: RunCollaborators['runStore'];
    recordedTurnSummaries?: PreviousProviderSession[];
    recordedMemos?: RunMemo[];
    taskMonitorId?: string;
  },
): Run => {
  const recorded = overrides?.recordedTurnSummaries ?? [];
  const recordedMemos = overrides?.recordedMemos ?? [];
  const touchedFiles = overrides?.touchedFiles ?? new Set<string>();
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'];
  const runStore = createPromptTypeHandlerTestRunStore();
  vi.spyOn(runStore, 'updateRunFinalAssistantMessage').mockResolvedValue({} as AgenticSession);
  vi.spyOn(runStore, 'getFileChangeFacts').mockResolvedValue([]);
  vi.spyOn(runStore, 'getTouchedFiles').mockResolvedValue([]);
  vi.spyOn(runStore, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(runStore, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue({} as AgenticSession);
  vi.spyOn(runStore, 'updateRunPromptType').mockResolvedValue({} as AgenticSession);
  vi.spyOn(runStore, 'recordRunStartedPromptType').mockResolvedValue({} as AgenticSession);
  const broadcaster = createTestRunEventPublisher();
  const run = new Run(
    {
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      provider: overrides?.provider ?? 'claude',
      session: {
        entity:
          overrides?.taskId === undefined || overrides.taskId === null
            ? null
            : { entityType: 'TASK', entityId: overrides.taskId },
        agentic_session_id: 'run-1',
        provider: overrides?.provider ?? 'claude',
        provider_session_id: overrides?.providerSessionId ?? 'sess-test-1',
        provider_conversation_id: null,
        status: 'ACTIVE',
        serviceId: null,
        conversationId: 'conv-1',
        contextMetadata: {
          organizationId: 'org-1',
          projectId: 'proj-1',
          agentSessionId: overrides?.agentSessionId ?? 'agent-session-1',
          ...(overrides?.taskMonitorId ? { taskMonitorId: overrides.taskMonitorId } : {}),
        },
        events: [],
      } as unknown as ConstructorParameters<typeof Run>[0]['session'],
    },
    {
      runStore: overrides?.persistenceStore ?? runStore,
      repoStore: createTestRepoMappingStore(),
      poster: makePoster(),
      broadcaster,
      handlerDeps: createPromptTypeHandlerTestDeps({
        runStore,
        fetchImpl: fetch,
        apiBaseUrl: 'http://localhost',
        logger,
      }),
      ...createTestRunOwnership(),
      runnerPicker: createTestRunnerPicker(),
      logger,
    },
  );

  run.pendingDiffs = overrides?.pendingDiffs ?? new Map<string, PendingDiff>();
  run.touchedFiles = touchedFiles;
  run.triggerContext = overrides?.triggerContext ?? null;
  run.lastSubmissionAction = overrides?.lastSubmissionAction ?? null;
  run.activeTurn = overrides?.activeTurn ?? null;
  Object.defineProperty(run, 'lastProviderStreamMessage', {
    configurable: true,
    get: () => overrides?.lastProviderStreamMessage ?? null,
  });

  vi.spyOn(run, 'recordPreviousProviderSession').mockImplementation(
    overrides?.recordPreviousProviderSession ??
      ((summary: PreviousProviderSession) => {
        recorded.push(summary);
      }),
  );
  vi.spyOn(run, 'appendMemo').mockImplementation(
    overrides?.appendMemo ??
      ((memo: RunMemo) => {
        recordedMemos.push(memo);
      }),
  );
  vi.spyOn(run, 'recordTouchedFile').mockImplementation(
    overrides?.recordTouchedFile ??
      ((file: string) => {
        touchedFiles.add(file);
      }),
  );
  if (!overrides?.persistenceStore) {
    vi.spyOn(run, 'recordToolUsage').mockImplementation(overrides?.recordToolUsage ?? vi.fn());
  }
  vi.spyOn(run, 'observeProviderPhase').mockImplementation(
    overrides?.observeProviderPhase ?? (() => {}),
  );
  vi.spyOn(run, 'stageFileChanges').mockImplementation(overrides?.stageFileChanges ?? (() => {}));
  vi.spyOn(run, 'confirmStagedFileChange').mockImplementation(
    overrides?.confirmStagedFileChange ?? (async () => {}),
  );
  vi.spyOn(run, 'recordFileChanges').mockImplementation(
    overrides?.recordFileChanges ?? (async () => {}),
  );
  vi.spyOn(run, 'recordReportedFileChanges').mockImplementation(
    overrides?.recordReportedFileChanges ??
      (async () => ({ admitted: [], corrected: [], rejected: [] })),
  );
  vi.spyOn(run, 'enrichFileChangeEvidence').mockImplementation(
    overrides?.enrichFileChangeEvidence ?? (async () => {}),
  );
  vi.spyOn(run, 'getFileChangeProjection').mockImplementation(
    overrides?.getFileChangeProjection ??
      (() =>
        [...touchedFiles].map((file) => ({
          serviceId: 'test-service',
          repoRelativePath: file,
        }))),
  );
  vi.spyOn(run, 'readReportChain').mockImplementation(overrides?.readReportChain ?? (() => []));
  vi.spyOn(run, 'logImplementReportValidation').mockImplementation(
    overrides?.logImplementReportValidation ?? (() => {}),
  );
  vi.spyOn(run, 'recordPendingCompletion').mockImplementation(
    overrides?.recordPendingCompletion ?? (() => {}),
  );
  vi.spyOn(run, 'recordPermissionRequestMessage').mockImplementation(
    overrides?.recordPermissionRequestMessage ?? (() => {}),
  );
  vi.spyOn(run, 'getPermissionRequestMessage').mockImplementation(
    overrides?.getPermissionRequestMessage ?? (() => undefined),
  );
  const claimNarration = vi.spyOn(run, 'claimNarration');
  if (overrides?.claimNarration) claimNarration.mockImplementation(overrides.claimNarration);
  const resolveNarrationMessageId = vi.spyOn(run, 'resolveNarrationMessageId');
  if (overrides?.resolveNarrationMessageId) {
    resolveNarrationMessageId.mockImplementation(overrides.resolveNarrationMessageId);
  }
  const rejectNarrationMessageId = vi.spyOn(run, 'rejectNarrationMessageId');
  if (overrides?.rejectNarrationMessageId) {
    rejectNarrationMessageId.mockImplementation(overrides.rejectNarrationMessageId);
  }

  return run;
};

export const defaultTestTurnHandler: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  expectedResponseTypes: [
    'final_assessment_v2',
    'startup_plan_v1',
    'neighborhood_task_updates_v1',
    'verification_plan_v1',
    'child_task_description_update_v1',
    'set_splitting_v1',
    'rollup_proposal_v1',
    'daily_session_v1',
    'report_update_v1',
    'plan_shaping_feature_sync_analyze_v1',
    'agent_search_results_v1',
    'goal_pm_routing_v1',
  ],
  emitLegacyStartupPlanUiElement: true,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => '',
};

/** Build a real Turn owner for handler tests. */
export const makeTestTurn = (
  handler: PromptTypeHandler<unknown> = defaultTestTurnHandler,
  turnId = 'turn-1',
  platformMcpProxy: TurnPlatformMcpProxy | null = null,
  payload?: unknown,
): Turn => {
  const owner = makeTestRun();
  const turn = new Turn({
    effectiveRole: 'implementation',
    turnId,
    payload,
    runId: owner.runId,
    resolvedPrompt: '',
    handler,
    externalAgentNodeId: null,
    triggerMessageId: null,
    runner: { run: async () => undefined },
    platformMcpProxy,
    abortController: new AbortController(),
    effectiveModel: null,
    effectiveReasoningEffort: null,
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RunCollaborators['logger'],
    owner,
  });
  turn.changedFileReporting.report([]);
  // These unit tests exercise publication after Run has released reporting.
  turn.changedFileReporting.release();
  return turn;
};
