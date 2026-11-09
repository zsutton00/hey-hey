import { describe, expect, it, vi } from 'vitest';
import { LocalPromptType, type LocalRunEvalPromptPayload } from '@hey-hey/contracts/agent-bridge';
import type { ProceduralRunContext } from '../prompt-type-handler';
import { runEvalHandler } from './run-eval.handler';

const CASE_CREATED_AT = '2026-01-01T00:00:00.000Z';

const EVAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AUTHORING_CONVERSATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AUTHORING_MESSAGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// The platform reads that set an attempt's search scope: the Eval Case with its Eval, and the
// proposals made about it with the conversations they were made in, and everything connected to them.
const mockCaseReads = async (listProposals?: () => Promise<unknown>) => {
  const { TasksApi, ProposalsApi, TopologyApi } = await import('@hey-hey/contracts/api');
  vi.spyOn(TopologyApi.prototype, 'getTopologyConnectedEntities').mockImplementation((async ({
    connectedEntitiesRequest,
  }: {
    connectedEntitiesRequest: { entityIds: string[] };
  }) => ({
    data: { data: { entityIds: [...connectedEntitiesRequest.entityIds, AUTHORING_MESSAGE_ID] } },
  })) as never);
  vi.spyOn(
    TasksApi.prototype,
    'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet',
  ).mockResolvedValue({
    data: { data: { createdAt: CASE_CREATED_AT, parentTaskId: EVAL_ID } },
  } as never);
  vi.spyOn(ProposalsApi.prototype, 'listProposals').mockImplementation(
    (listProposals ??
      (async () => ({
        data: {
          data: {
            data: [{ id: PROPOSAL_ID, conversationId: AUTHORING_CONVERSATION_ID }],
            total: 1,
            limit: 100,
            offset: 0,
          },
        },
      }))) as never,
  );
};

const attempt = {
  attemptId: '33333333-3333-4333-8333-333333333333',
  execution: {
    handler: 'entity_conversation' as const,
    projectAssistantPrepares: false,
    assessedOutput: 'HANDLER_REPLY' as const,
  },
  targetSessionId: '77777777-7777-4777-8777-777777777777',
  targetConversationId: '88888888-8888-4888-8888-888888888888',
  configuration: {
    id: '44444444-4444-4444-8444-444444444444',
    target: {
      provider: 'claude',
      model: 'sonnet',
      reasoningEffort: 'high',
      handlerConfig: { projectAssistant: { enabled: false } },
    },
  },
  caseInput: {
    id: '55555555-5555-4555-8555-555555555555',
    evalCaseId: '66666666-6666-4666-8666-666666666666',
    title: 'Finds the stale requirement',
    target: {
      situation: 'A requirement no longer matches the shipped behaviour.',
      initiatingRequest: 'Find what is out of date.',
      targetHandler: 'agent_search' as const,
    },
    grading: {
      expectations: 'SECRET-EXPECTATION',
      checks: [{ id: 'c1', description: 'SECRET-CHECK' }],
      rubric: [{ key: 'relevance', name: 'Relevance', description: 'SECRET-RUBRIC' }],
    },
  },
};

const payload: LocalRunEvalPromptPayload = {
  userMessage: 'Run the evaluation.',
  evalRunId: '22222222-2222-4222-8222-222222222222',
  judgeSetup: { provider: 'claude', model: 'opus' },
  settings: { maxConcurrentAttempts: 3 },
  cases: [attempt.caseInput],
  attempts: [attempt],
};

describe('runEvalHandler', () => {
  it('declares a procedural EVAL-only handler', () => {
    expect(runEvalHandler).toMatchObject({
      id: 'run_eval',
      promptType: LocalPromptType.RunEval,
      eligibleWorkItemTypeKeys: ['EVAL'],
      runnerKind: 'procedural',
      service: 'optional',
      reports: [],
    });
  });

  it.each(['judge-provider-real', 'pending_judge'])(
    'records only real judge identity (%s) alongside the outcome',
    async (providerSessionId) => {
      const launches: { handlerId: string; payload: unknown; request: Record<string, unknown> }[] =
        [];
      const launchRegistered = vi.fn(
        async (handlerId: string, request: Record<string, unknown>) => {
          launches.push({ handlerId, payload: request['payload'], request });
          const onIdentity = request['onProviderSessionId'];
          if (typeof onIdentity === 'function') {
            await onIdentity(providerSessionId);
          }
          return {
            providerSessionId,
            assistantCompleted: true,
            outputText: JSON.stringify({
              checkResults: [{ checkId: 'c1', passed: true, explanation: 'ok' }],
              recognition: { recognized: true, explanation: 'noticed' },
              quality: [{ key: 'relevance', name: 'Relevance', score: 4, explanation: 'good' }],
            }),
            usage: {},
          };
        },
      );
      const reports = new Map<string, Record<string, unknown>>([
        [payload.evalRunId, { reportType: 'EVAL_RUN', status: 'QUEUED' }],
        [attempt.attemptId, { reportType: 'EVAL_ATTEMPT', status: 'QUEUED', measurements: [] }],
      ]);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const saved: Record<string, unknown>[] = [];
      const { ConversationsApi } = await import('@hey-hey/contracts/api');
      vi.spyOn(ConversationsApi.prototype, 'postMessage').mockImplementation(
        async (request, options) => {
          saved.push({ ...request.postMessageRequest, headers: options?.headers });
          return { data: { data: { id: `message-${saved.length}` } } } as never;
        },
      );
      const { ReportsApi } = await import('@hey-hey/contracts/api');
      vi.spyOn(ReportsApi.prototype, 'getReport').mockImplementation(
        async (request) =>
          ({
            data: { data: { id: request.reportId, payload: reports.get(request.reportId) } },
          }) as never,
      );
      vi.spyOn(ReportsApi.prototype, 'updateReport').mockImplementation(async (request) => {
        reports.set(
          request.reportId,
          request.updateReportDto.payload as unknown as Record<string, unknown>,
        );
        return {} as never;
      });

      await mockCaseReads();
      const searchScopes: unknown[] = [];
      const ctx = {
        session: {
          agentic_session_id: 'run-1',
          contextMetadata: { organizationId: 'org-1', projectId: 'project-1' },
        },
        deps: {
          auth: { getAccessToken: async () => 'token' },
          apiBaseUrl: 'http://api.test',
          logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
          evalAttemptExecution: {
            sweepWorkspaces: () => Promise.resolve(),
            execute: (
              _session: unknown,
              recorded: typeof attempt,
              options: { searchScope: unknown },
            ) => {
              searchScopes.push(options.searchScope);
              launches.push({
                handlerId: recorded.caseInput.target.targetHandler,
                payload: { userMessage: recorded.caseInput.target.initiatingRequest },
                request: {},
              });
              return Promise.resolve({
                assistantCompleted: true,
                outputText: 'Found it.',
                usage: { inputTokens: 10, outputTokens: 5, toolCalls: 2 },
              });
            },
          },
          childAgentLauncher: { launchRegistered },
        },
      } as unknown as ProceduralRunContext;

      const summary = await runEvalHandler.runProcedure!(
        payload,
        ctx,
        new AbortController().signal,
      );

      expect(summary).toBe('Eval run finished: 1 completed, 0 with errors, 0 stopped.');
      expect(searchScopes).toEqual([
        {
          createdBefore: CASE_CREATED_AT,
          excludeConnectedTo: [
            attempt.caseInput.evalCaseId,
            EVAL_ID,
            PROPOSAL_ID,
            AUTHORING_CONVERSATION_ID,
          ],
          hiddenEntityIds: [
            attempt.caseInput.evalCaseId,
            EVAL_ID,
            PROPOSAL_ID,
            AUTHORING_CONVERSATION_ID,
            AUTHORING_MESSAGE_ID,
          ],
        },
      ]);
      expect(launches.map((launch) => launch.handlerId)).toEqual(['agent_search', 'eval_judge']);
      const targetLaunch = launches[0]!;
      expect(JSON.stringify(targetLaunch.payload)).not.toMatch(/SECRET/);
      expect(reports.get(payload.evalRunId)).toMatchObject({ status: 'FINISHED' });
      expect(reports.get(attempt.attemptId)).toMatchObject({
        status: 'COMPLETED',
        measurements: [{ scope: 'TARGET_HANDLER', inputTokens: 10, outputTokens: 5, toolCalls: 2 }],
        automatedAssessment: { recognition: { recognized: true } },
      });
      expect(reports.get(attempt.attemptId)?.['judgeProviderSessionId']).toBe(
        providerSessionId.startsWith('pending_') ? undefined : providerSessionId,
      );
      expect(reports.get(attempt.attemptId)!['measurements']).toHaveLength(1);
      expect(saved).toHaveLength(0);
      expect(launches[1]!.request).not.toHaveProperty('onAgentOutput');
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    },
  );
  it('fails an attempt alone when its case proposals cannot be read, never searching unscoped', async () => {
    await mockCaseReads(() => Promise.reject(new Error('proposals unavailable')));
    const reports = new Map<string, Record<string, unknown>>([
      [payload.evalRunId, { reportType: 'EVAL_RUN', status: 'QUEUED' }],
      [attempt.attemptId, { reportType: 'EVAL_ATTEMPT', status: 'QUEUED', measurements: [] }],
    ]);
    const { ReportsApi } = await import('@hey-hey/contracts/api');
    vi.spyOn(ReportsApi.prototype, 'getReport').mockImplementation(
      async (request) =>
        ({
          data: { data: { id: request.reportId, payload: reports.get(request.reportId) } },
        }) as never,
    );
    vi.spyOn(ReportsApi.prototype, 'updateReport').mockImplementation(async (request) => {
      reports.set(
        request.reportId,
        request.updateReportDto.payload as unknown as Record<string, unknown>,
      );
      return {} as never;
    });
    const execute = vi.fn();
    const ctx = {
      session: {
        agentic_session_id: 'run-1',
        contextMetadata: { organizationId: 'org-1', projectId: 'project-1' },
      },
      deps: {
        auth: { getAccessToken: async () => 'token' },
        apiBaseUrl: 'http://api.test',
        logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        evalAttemptExecution: { sweepWorkspaces: () => Promise.resolve(), execute },
        childAgentLauncher: { launchRegistered: vi.fn() },
      },
    } as unknown as ProceduralRunContext;

    const summary = await runEvalHandler.runProcedure!(payload, ctx, new AbortController().signal);

    expect(summary).toContain('1 with errors');
    expect(execute).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
