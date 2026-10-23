import { describe, expect, it, vi } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handleAssistantComplete } from './assistant-complete';
import { makePoster, makeDeps, makeTestRun, makeTestTurn } from './__test-utils';
import { createTestReportSyncService } from '../run.test-support';
import type { LocalAgentOutputEvent, AssistantCompleteEvent } from '../types';
import type { PromptTypeHandler } from '../../agents/prompt-type-handler';
import { createOnCompleteTestDeps } from '../../agents/prompt-type-handler.test-support';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { FEATURE_SYNC_ACTIONS } from '../../agents/feature-sync/submission-tools';
import { codingPlanHandler } from '../../agents/coding-plan/coding-plan.handler';
import { dailySessionCoachHandler } from '../../agents/daily-session/daily-session-coach.handler';
import { repositoryPlacementHandler } from '../../agents/repository-placement/repository-placement.handler';
import { codingFreeformHandler, freeFormHandler } from '../../agents/coding-conversation';
import { ActivePlatformToolCatalog } from '../../agents/platform-mcp-proxy/catalog';
import { PlatformMcpForwarder } from '../../agents/platform-mcp-proxy/forwarder';
import { TurnPlatformMcpProxy } from '../../agents/platform-mcp-proxy/turn-proxy';
import { IncludeExistingProposalsInCurrentMessageTool } from '../../agents/submission-tools/include-existing-proposals-in-current-message-tool';
import { createTestOAuthClient } from '../../auth/oauth-client.test-support';
import { NOOP_LOGGER } from '../../server/logger';
import {
  ExtendedUIFieldType,
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
} from '../../shared/api/index';
import type { MessagePosterCreateOutOfBandArgs } from '../types';

const outOfBandCalls = (poster: { createOutOfBand: unknown }) =>
  (poster.createOutOfBand as ReturnType<typeof vi.fn>).mock.calls;

const outOfBandDto = (poster: { createOutOfBand: unknown }, idx = 0) =>
  (outOfBandCalls(poster)[idx]![0] as MessagePosterCreateOutOfBandArgs).dto as unknown as {
    data?: Record<string, unknown>;
  };

const makeRawAssistantComplete = (summary: string): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'agent_output',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    messageType: 'assistant',
    taskComplete: true,
    summary,
  },
});

const makePlatformMcpForwarder = (forward: PlatformMcpForwarder['forward']) => {
  const forwarder = new PlatformMcpForwarder({
    oauthClient: createTestOAuthClient(),
    logger: NOOP_LOGGER,
    fetchImpl: vi.fn<typeof fetch>(),
    endpointUrl: 'https://api.test/mcp',
  });
  vi.spyOn(forwarder, 'forward').mockImplementation(forward);
  return forwarder;
};

describe('assistant_complete end-to-end', () => {
  it('raw event normalizes to AssistantCompleteEvent with correct fields', () => {
    const raw = makeRawAssistantComplete('The task is done.');
    const normalized = normalizeEvent(raw, 'claude');

    expect(normalized.kind).toBe('assistant_complete');
    const event = normalized as AssistantCompleteEvent;
    expect(event.summary).toBe('The task is done.');
    expect(event.runId).toBe('run-1');
  });

  it('handler completes the processing message with summary content', async () => {
    const raw = makeRawAssistantComplete('The task is done.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun();
    const observeFinalAssistantMessageCommitted = vi.spyOn(
      ctx,
      'observeFinalAssistantMessageCommitted',
    );
    const deps = makeDeps(poster);
    const eventTurn = makeTestTurn({
      promptType: 'coding_freeform',
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(eventTurn.completedAssistantMessageId).toBe('oob-msg-1');
    expect(observeFinalAssistantMessageCommitted).toHaveBeenCalledWith(
      eventTurn.turnId,
      'oob-msg-1',
    );
    expect(poster.complete).not.toHaveBeenCalled();
    expect(poster.createOutOfBand).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: {
        type: MessageType.System,
        status: MessageStatus.Completed,
        projectId: 'proj-1',
        proposalIds: [],
        reportIds: [],
        data: {
          type: 'AGENT',
          response: 'The task is done.',
          detectedIntent: 'agent_response',
          intentConfidence: 1,
          providerSessionId: 'sess-test-1',
          promptHandler: 'coding_freeform',
          actionHint: 'task_complete',
        },
      },
      stamp: { providerSessionId: 'sess-test-1', promptHandler: 'coding_freeform' },
    });
  });

  it('does not expose a repository placement completion as raw JSON', async () => {
    const rawSummary = JSON.stringify({
      outcome: 'success',
      placements: [
        {
          rootKey: '11111111-1111-4111-8111-111111111111',
          target: { kind: 'PROJECT_ROOT' },
          rationale: 'It is a top-level capability.',
          confidence: 0.9,
        },
      ],
    });
    const event = normalizeEvent(
      makeRawAssistantComplete(rawSummary),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const handler: PromptTypeHandler<unknown> = {
      id: 'repository-placement-completion-test',
      promptType: LocalPromptType.RepositoryPlacement,
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
      transformCompletionOutput: repositoryPlacementHandler.transformCompletionOutput!,
    };

    await handleAssistantComplete(event, makeTestRun(), makeDeps(poster), makeTestTurn(handler));

    expect(outOfBandDto(poster).data).toMatchObject({
      response: 'Repository placement analysis completed.',
      processResponseType: LocalPromptType.RepositoryPlacement,
      uiElements: [
        {
          id: 'repository-placement-completion',
          type: ExtendedUIFieldType.AgentHidden,
        },
      ],
    });
    expect(outOfBandDto(poster).data?.['response']).not.toBe(rawSummary);
  });

  it('publishes included existing and new proposals in retry-stable order without carriers', async () => {
    const event = normalizeEvent(
      makeRawAssistantComplete('The task is done.'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun();
    vi.spyOn(ctx, 'readReportIdsForTurn')
      .mockReturnValueOnce(['report-1', 'report-2'])
      .mockReturnValueOnce(['different-report']);
    const eventTurn = makeTestTurn({
      promptType: 'coding_freeform',
    } as PromptTypeHandler<unknown>);
    eventTurn.recordCreatedProposal('11111111-1111-4111-8111-111111111111');
    const existingId = '33333333-3333-4333-8333-333333333333';
    new IncludeExistingProposalsInCurrentMessageTool().execute({
      runId: ctx.runId,
      args: { proposalIds: [existingId, '11111111-1111-4111-8111-111111111111'] },
      run: { activeTurn: eventTurn } as never,
    });
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    vi.mocked(poster.createOutOfBand)
      .mockRejectedValueOnce(new Error('publication failed'))
      .mockResolvedValueOnce('oob-msg-1');

    await handleAssistantComplete(event, ctx, makeDeps(poster), eventTurn);
    expect(eventTurn.readCreatedProposalIds()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      existingId,
    ]);

    eventTurn.recordCreatedProposal('22222222-2222-4222-8222-222222222222');
    await handleAssistantComplete(event, ctx, makeDeps(poster), eventTurn);

    for (const call of outOfBandCalls(poster)) {
      expect(call[0]).toMatchObject({
        dto: {
          proposalIds: ['11111111-1111-4111-8111-111111111111', existingId],
          reportIds: ['report-1', 'report-2'],
        },
      });
    }
    expect(eventTurn.readCreatedProposalIds()).toEqual([]);
    expect(poster.createOutOfBand).toHaveBeenCalledTimes(2);
    expect(poster.complete).not.toHaveBeenCalled();
    expect(eventTurn.completedAssistantMessageId).toBe('oob-msg-1');
  });

  it('publishes surviving and recreated Proposals after standalone deletion', async () => {
    const event = normalizeEvent(
      makeRawAssistantComplete('The task is done.'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const survivingProposalId = '11111111-1111-4111-8111-111111111111';
    const deletedProposalId = '22222222-2222-4222-8222-222222222222';
    const recreatedProposalId = '33333333-3333-4333-8333-333333333333';
    const forward = vi
      .fn<PlatformMcpForwarder['forward']>()
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: { proposalId: survivingProposalId } },
      })
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 2,
        result: { structuredContent: { proposalId: deletedProposalId } },
      })
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 3,
        result: { isError: true, content: [{ type: 'text', text: 'delete failed' }] },
      })
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 4,
        result: { content: [{ type: 'text', text: '{"deleted":true}' }] },
      })
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 5,
        result: { structuredContent: { proposalId: recreatedProposalId } },
      });
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'proj-1' },
      catalog: new ActivePlatformToolCatalog({
        additionalTools: ['create_work_item', 'delete_proposal'],
      }),
      activeHandlerPromptType: 'entity_conversation',
    });
    const eventTurn = makeTestTurn(codingFreeformHandler, 'turn-1', proxy);
    const forwarder = makePlatformMcpForwarder(forward);

    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_work_item', arguments: {} },
      },
      forwarder,
    );
    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'create_work_item', arguments: {} },
      },
      forwarder,
    );
    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'delete_proposal',
          arguments: { proposalId: deletedProposalId },
        },
      },
      forwarder,
    );
    expect(eventTurn.readCreatedProposalIds()).toEqual([survivingProposalId, deletedProposalId]);

    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'delete_proposal',
          arguments: { proposalId: deletedProposalId },
        },
      },
      forwarder,
    );
    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'create_work_item', arguments: {} },
      },
      forwarder,
    );

    await handleAssistantComplete(event, makeTestRun(), makeDeps(poster), eventTurn);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(outOfBandDto(poster)).toMatchObject({
      proposalIds: [survivingProposalId, recreatedProposalId],
    });
    expect(forward).toHaveBeenCalledTimes(5);
  });

  it.each([
    ['omitted', { response: 'Published response' }],
    ['explicit null', { response: 'Published response', featureUpdateSyncCheck: null }],
    ['malformed', { response: 'Published response', featureUpdateSyncCheck: {} }],
  ])(
    'publishes a valid coding response when older feature metadata is %s',
    async (_label, envelope) => {
      const event = normalizeEvent(
        makeRawAssistantComplete(JSON.stringify(envelope)),
        'claude',
      ) as AssistantCompleteEvent;
      const poster = makePoster();

      await handleAssistantComplete(
        event,
        makeTestRun(),
        makeDeps(poster),
        makeTestTurn(codingFreeformHandler),
      );

      expect(outOfBandDto(poster).data).toMatchObject({ response: 'Published response' });
      expect(outOfBandDto(poster).data).not.toHaveProperty('uiElements');
    },
  );

  it('publishes an older envelope carrying a feature check as a plain reply', async () => {
    const check = {
      feature: {
        entityType: 'FEATURE' as const,
        entityId: '33333333-3333-4333-8333-333333333333',
      },
      explanation: 'Delivered behavior changed.',
    };
    const event = normalizeEvent(
      makeRawAssistantComplete(
        JSON.stringify({ response: 'Published response', featureUpdateSyncCheck: check }),
      ),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();

    await handleAssistantComplete(
      event,
      makeTestRun(),
      makeDeps(poster),
      makeTestTurn(codingFreeformHandler),
    );

    expect(outOfBandDto(poster).data).toMatchObject({ response: 'Published response' });
    expect(outOfBandDto(poster).data).not.toHaveProperty('uiElements');
    expect(JSON.stringify(outOfBandDto(poster))).not.toContain('featureUpdateSyncCheck');
  });

  it('attaches the Verify Feature action when the agent raised a concern this Turn', async () => {
    const suggestion = {
      feature: {
        entityType: 'FEATURE' as const,
        entityId: '33333333-3333-4333-8333-333333333333',
      },
      explanation: 'The Mockup shows a Retry button; the dialog has none.',
      impactedEntities: [
        { entityType: 'MOCKUP', entityId: '44444444-4444-4444-8444-444444444444' },
      ],
    };
    const event = normalizeEvent(
      makeRawAssistantComplete('Published response'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const eventTurn = makeTestTurn(codingFreeformHandler);
    eventTurn.recordFeatureVerificationSuggestion(suggestion);

    await handleAssistantComplete(event, makeTestRun(), makeDeps(poster), eventTurn);

    expect(outOfBandDto(poster).data).toMatchObject({
      response: 'Published response',
      uiElements: [{ type: 'verify_feature', payload: suggestion }],
    });
  });

  it.each([
    ['Open launch', freeFormHandler],
    ['coding follow-up', codingFreeformHandler],
  ] as const)(
    'ignores completion-time changed files for the %s Turn before publishing the response',
    async (_label, handler) => {
      const changedFiles = [{ serviceId: 'service-1', path: 'src/a.ts' }];
      const event = normalizeEvent(
        makeRawAssistantComplete(JSON.stringify({ response: 'Done', changedFiles })),
        'claude',
      ) as AssistantCompleteEvent;
      const poster = makePoster();
      const ctx = makeTestRun();
      const eventTurn = makeTestTurn(handler as unknown as PromptTypeHandler<unknown>);

      await handleAssistantComplete(event, ctx, makeDeps(poster), eventTurn);

      expect(ctx.recordReportedFileChanges).not.toHaveBeenCalled();
      expect(outOfBandDto(poster).data).toMatchObject({ response: 'Done' });
    },
  );

  it.each([
    ['missing', {}],
    ['malformed', { changedFiles: [{ path: 'src/a.ts' }] }],
  ])(
    'publishes the response but records no files when changedFiles is %s',
    async (_label, extra) => {
      const event = normalizeEvent(
        makeRawAssistantComplete(JSON.stringify({ response: 'Done', ...extra })),
        'claude',
      ) as AssistantCompleteEvent;
      const poster = makePoster();
      const ctx = makeTestRun();
      const deps = makeDeps(poster);

      await handleAssistantComplete(event, ctx, deps, makeTestTurn(codingFreeformHandler));

      expect(ctx.recordReportedFileChanges).not.toHaveBeenCalled();
      expect(outOfBandDto(poster).data).toMatchObject({ response: 'Done' });
    },
  );

  it.each([{}, { featureUpdateSyncCheck: null }, { response: '' }])(
    'rejects invalid primary completion and retains attachments (%j)',
    async (envelope) => {
      const event = normalizeEvent(
        makeRawAssistantComplete(JSON.stringify(envelope)),
        'claude',
      ) as AssistantCompleteEvent;
      const poster = makePoster();
      const eventTurn = makeTestTurn(codingFreeformHandler);
      eventTurn.recordCreatedProposal('11111111-1111-4111-8111-111111111111');

      await handleAssistantComplete(event, makeTestRun(), makeDeps(poster), eventTurn);

      expect(poster.createOutOfBand).not.toHaveBeenCalled();
      expect(eventTurn.readCreatedProposalIds()).toEqual(['11111111-1111-4111-8111-111111111111']);
    },
  );

  it('publishes Daily Session coach prose as an ordinary assistant message', async () => {
    const summary = 'You spent time in the dashboard area; does that still match your focus?';
    const event = normalizeEvent(
      makeRawAssistantComplete(summary),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();

    await handleAssistantComplete(
      event,
      makeTestRun(),
      makeDeps(poster),
      makeTestTurn(dailySessionCoachHandler),
    );

    expect(outOfBandDto(poster).data).toMatchObject({
      type: SystemMessageDataTypeEnum.Agent,
      response: summary,
      detectedIntent: 'agent_response',
      promptHandler: LocalPromptType.DailySession,
      actionHint: 'task_complete',
    });
    expect(outOfBandDto(poster).data?.['responseType']).toBeUndefined();
  });

  it('defers output attention until the completed Turn boundary', async () => {
    const event = normalizeEvent(
      makeRawAssistantComplete('The task is done.'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    deps.onCompleteDeps = createOnCompleteTestDeps({
      fetchImpl: fetchImpl as typeof fetch,
      apiBaseUrl: 'https://platform.test/api/v1',
      logger: deps.logger,
      poster,
    });
    const eventTurn = makeTestTurn({
      promptType: 'coding_freeform',
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, makeTestRun(), deps, eventTurn);

    expect(eventTurn.completedAssistantMessageId).toBe('oob-msg-1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defers output attention for a typed terminal message with an empty raw summary', async () => {
    const event = normalizeEvent(makeRawAssistantComplete(''), 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({
      fetchImpl: fetchImpl as typeof fetch,
      apiBaseUrl: 'https://platform.test/api/v1',
      logger: deps.logger,
      poster,
    });
    const handler = {
      promptType: LocalPromptType.TaskMonitor,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
      validateCompletion: () => ({ ok: true as const }),
      transformCompletionOutput: () => ({
        data: {
          type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
          response: 'Canonical evidence is complete.',
          agentIdentity: 'task-monitor-coordinator',
          outcome: 'ACCEPTED',
          rationale: 'Canonical evidence is complete.',
        },
      }),
    } as unknown as PromptTypeHandler<unknown>;

    const eventTurn = makeTestTurn(handler);
    await handleAssistantComplete(event, makeTestRun(), deps, eventTurn);

    expect(outOfBandDto(poster).data).toMatchObject({
      response: 'Canonical evidence is complete.',
    });
    expect(eventTurn.completedAssistantMessageId).toBe('oob-msg-1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not set output attention when terminal message persistence fails', async () => {
    const event = normalizeEvent(
      makeRawAssistantComplete('The task is done.'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    vi.mocked(poster.createOutOfBand).mockRejectedValueOnce(new Error('publication failed'));
    const deps = makeDeps(poster);
    const fetchImpl = vi.fn();
    deps.onCompleteDeps = createOnCompleteTestDeps({
      fetchImpl: fetchImpl as typeof fetch,
      apiBaseUrl: 'https://platform.test/api/v1',
      logger: deps.logger,
      poster,
    });
    const eventTurn = makeTestTurn({
      promptType: 'coding_freeform',
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, makeTestRun(), deps, eventTurn);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects handler-invalid output before appending a completion message', async () => {
    const raw = makeRawAssistantComplete('invalid coordinator output');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onInvalidCompletion = vi.fn().mockResolvedValue(undefined);
    const validateCompletion = vi.fn().mockReturnValue({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: 'The completion does not match the handler contract.',
      },
    });
    const handler: PromptTypeHandler<unknown> = {
      promptType: LocalPromptType.TaskMonitor,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
      validateCompletion,
      onInvalidCompletion,
      onComplete,
    } as unknown as PromptTypeHandler<unknown>;
    const eventTurn = makeTestTurn(handler);
    eventTurn.recordCreatedProposal('11111111-1111-4111-8111-111111111111');
    const ctx = makeTestRun();
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiBaseUrl: 'https://example.test',
      logger: deps.logger,
      poster,
    });

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    expect(validateCompletion).toHaveBeenCalledWith(event, undefined);
    // Correction remains available: nothing is published and the trigger stays open.
    expect(onInvalidCompletion).not.toHaveBeenCalled();
    expect(eventTurn.completionCorrection.hasPendingRejection).toBe(true);
    expect(ctx.recordPendingCompletion).not.toHaveBeenCalled();

    // Exhaustion re-dispatches the last rejection exactly once.
    expect(eventTurn.completionCorrection.exhaust()).toBe(event);
    await handleAssistantComplete(event, ctx, deps, eventTurn);
    expect(eventTurn.completionCorrection.exhaust()).toBeNull();
    expect(onInvalidCompletion).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(ctx.recordPreviousProviderSession).not.toHaveBeenCalled();
    eventTurn.recordCreatedProposal('22222222-2222-4222-8222-222222222222');
    expect(eventTurn.readCreatedProposalIds()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'local.handler.assistant_complete.pre_completion_validation_failed',
      expect.objectContaining({ runId: 'run-1', code: 'SCHEMA_VALIDATION_FAILED' }),
    );
  });

  it('publishes a corrected answer as the only outcome after a rejected one', async () => {
    const invalid = normalizeEvent(
      makeRawAssistantComplete('invalid'),
      'claude',
    ) as AssistantCompleteEvent;
    const corrected = normalizeEvent(
      makeRawAssistantComplete('corrected'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const onInvalidCompletion = vi.fn().mockResolvedValue(undefined);
    const getCompletionAction = vi.fn((event: AssistantCompleteEvent) => ({
      action: { action: event.summary === 'corrected' ? 'success' : 'terminal_failure' },
      hidden: true,
      userFacingResponse: '',
    }));
    const handler = {
      promptType: LocalPromptType.TaskMonitor,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
      validateCompletion: (event: AssistantCompleteEvent) =>
        event.summary === 'corrected'
          ? { ok: true as const }
          : { ok: false as const, error: { message: 'bad', issues: ['/serviceId: mismatch'] } },
      getCompletionAction,
      onInvalidCompletion,
    } as unknown as PromptTypeHandler<unknown>;
    const ctx = makeTestRun();
    Object.assign(ctx, {
      triggerContext: { externalAgentNodeId: 'node-1', triggerMessageId: 'trigger-1' },
    });
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({ logger: deps.logger, poster });
    const eventTurn = makeTestTurn(handler);

    await handleAssistantComplete(invalid, ctx, deps, eventTurn);
    expect(eventTurn.completionCorrection.beginCorrection()).toContain('/serviceId: mismatch');
    await handleAssistantComplete(corrected, ctx, deps, eventTurn);
    eventTurn.completionCorrection.endCorrection();

    expect(eventTurn.completionCorrection.hasPendingRejection).toBe(false);
    expect(eventTurn.completionCorrection.exhaust()).toBeNull();
    expect(onInvalidCompletion).not.toHaveBeenCalled();
    expect(ctx.recordPendingCompletion).toHaveBeenCalledOnce();
    expect(ctx.recordPendingCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ action: { action: 'success' }, triggerMessageId: 'trigger-1' }),
    );
    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
  });

  it('persists a handler-owned typed terminal completion before releasing lifecycle effects', async () => {
    const event = normalizeEvent(
      makeRawAssistantComplete('validated coordinator output'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const handler = {
      promptType: LocalPromptType.TaskMonitor,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
      validateCompletion: () => ({ ok: true as const }),
      transformCompletionOutput: () => ({
        data: {
          type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
          response: 'Canonical evidence is complete.',
          agentIdentity: 'task-monitor-coordinator',
          outcome: 'ACCEPTED',
          rationale: 'Canonical evidence is complete.',
        },
      }),
      onComplete,
    } as unknown as PromptTypeHandler<unknown>;
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({ logger: deps.logger, poster });

    await handleAssistantComplete(event, makeTestRun(), deps, makeTestTurn(handler));

    expect(outOfBandDto(poster).data).toMatchObject({
      type: 'TASK_MONITOR_SUPERVISION',
      outcome: 'ACCEPTED',
      rationale: 'Canonical evidence is complete.',
    });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(vi.mocked(poster.createOutOfBand).mock.invocationCallOrder[0]).toBeLessThan(
      onComplete.mock.invocationCallOrder[0]!,
    );
  });

  it('does not release lifecycle effects when typed terminal persistence fails', async () => {
    const event = normalizeEvent(
      makeRawAssistantComplete('validated coordinator output'),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    vi.mocked(poster.createOutOfBand).mockRejectedValueOnce(new Error('publication failed'));
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const handler = {
      promptType: LocalPromptType.TaskMonitor,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
      validateCompletion: () => ({ ok: true as const }),
      transformCompletionOutput: () => ({
        data: {
          type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
          response: 'Canonical evidence is complete.',
        },
      }),
      onComplete,
    } as unknown as PromptTypeHandler<unknown>;
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({ logger: deps.logger, poster });

    await handleAssistantComplete(event, makeTestRun(), deps, makeTestTurn(handler));

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('handler dispatches structured responseType to the dispatcher and builds the UI element', async () => {
    const finalAssessmentJson = JSON.stringify({
      responseType: 'final_assessment_v2',
      taskAssessment: {
        target: { entityType: 'task', entityId: 'task-1' },
        verdict: 'completed',
        statusRecommendation: { status: 'COMPLETED', reason: 'ok' },
        summary: 'done',
      },
      hierarchyWalk: [
        {
          entityType: 'task',
          entityId: 'task-1',
          name: 'task',
          distance: 0,
          action: 'no_update',
          rationale: 'primary',
        },
      ],
    });
    const summary = `Preamble narrative.\n\n\`\`\`json\n${finalAssessmentJson}\n\`\`\``;
    const raw = makeRawAssistantComplete(summary);
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({ taskId: 'task-1' });
    const executeResponseSideEffect = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(poster);
    deps.reportSyncService = createTestReportSyncService(executeResponseSideEffect);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    const dto = outOfBandDto(poster) as { data: { uiElements?: unknown[] } };
    expect(dto.data.uiElements?.length).toBe(1);
    await Promise.resolve();
    expect(executeResponseSideEffect).not.toHaveBeenCalled();
  });

  it('resolves the current workflow node for an out-of-band readiness card', async () => {
    const response = {
      responseType: 'implementation_readiness_v1',
      disposition: {
        state: 'REVIEW_REQUIRED',
        sourceSnapshot: {
          runId: 'run-open-1',
          focalEntityId: 'task-open-1',
          focalEntityType: 'TASK',
          sourceRevision: 'sha256:open-source-revision',
          capturedAt: '2026-09-17T19:00:00.000Z',
        },
        finding: {
          affectedSourceContext: 'The task and its project context',
          unresolvedDecision: 'Which service owns the persisted readiness disposition?',
          consequentialInventionRisk: 'Coding would otherwise invent the observable behavior.',
          boundedEvidence: [
            {
              category: 'behavior',
              statement: 'The task leaves the observable outcome open.',
              sourceRef: 'Project Assistant memo',
            },
          ],
          answerKind: 'Name the authoritative owner and persistence boundary.',
        },
        resolution: { kind: 'NONE' },
      },
    };
    const summary = `Review needed.\n\n\`\`\`json\n${JSON.stringify(response)}\n\`\`\``;
    const event = normalizeEvent(
      makeRawAssistantComplete(summary),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun();
    const readCurrentWorkflowNodeId = vi
      .spyOn(ctx, 'readCurrentWorkflowNodeId')
      .mockResolvedValue('feature-sync-implementation-readiness-review');
    const eventTurn = makeTestTurn({
      promptType: LocalPromptType.FreeForm,
      expectedResponseTypes: ['implementation_readiness_v1'],
    } as unknown as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, ctx, makeDeps(poster), eventTurn);

    expect(readCurrentWorkflowNodeId).toHaveBeenCalledOnce();
    expect(outOfBandDto(poster).data).toMatchObject({
      nodeId: 'feature-sync-implementation-readiness-review',
      processResponseType: 'implementation_readiness_v1',
    });
  });

  it('publishes and persists an Open launch readiness response outside ordinary completion parsing', async () => {
    const disposition = {
      state: 'REVIEW_REQUIRED',
      sourceSnapshot: {
        runId: 'run-open-1',
        focalEntityId: 'task-open-1',
        focalEntityType: 'TASK',
        sourceRevision: 'sha256:open-source-revision',
        capturedAt: '2026-09-17T19:00:00.000Z',
      },
      finding: {
        affectedSourceContext: 'The task and its project context',
        unresolvedDecision: 'Which service owns the persisted readiness disposition?',
        consequentialInventionRisk: 'Coding would otherwise invent the observable behavior.',
        boundedEvidence: [
          {
            category: 'behavior',
            statement: 'The task leaves the observable outcome open.',
            sourceRef: 'Project Assistant memo',
          },
        ],
        answerKind: 'Name the authoritative owner and persistence boundary.',
      },
      resolution: { kind: 'NONE' },
    };
    const summary = `\`\`\`json\n${JSON.stringify({
      responseType: 'implementation_readiness_v1',
      disposition,
    })}\n\`\`\``;
    const event = normalizeEvent(
      makeRawAssistantComplete(summary),
      'claude',
    ) as AssistantCompleteEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({ logger: deps.logger, poster });
    const ctx = makeTestRun();
    vi.spyOn(ctx, 'readCurrentWorkflowNodeId').mockResolvedValue(null);
    const persist = vi
      .spyOn(ctx, 'persistImplementationReadinessFromAgentResponse')
      .mockResolvedValue(undefined as never);

    await handleAssistantComplete(
      event,
      ctx,
      deps,
      makeTestTurn(freeFormHandler as unknown as PromptTypeHandler<unknown>),
    );

    expect(outOfBandDto(poster).data).toMatchObject({
      processResponseType: 'implementation_readiness_v1',
    });
    expect(ctx.recordReportedFileChanges).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ state: 'REVIEW_REQUIRED' }));
  });

  it('persists a valid Goal PM completion as a typed UI field instead of raw JSON', async () => {
    const goalId = '11111111-1111-4111-8111-111111111111';
    const response = {
      responseType: 'goal_pm_routing_v1',
      goalId,
      options: [
        {
          optionId: 'existing-conversation',
          kind: 'existingConversation',
          conversationId: '44444444-4444-4444-8444-444444444444',
          title: 'Goal discussion',
          evidence: [
            {
              messageId: '33333333-3333-4333-8333-333333333333',
              excerpt: 'The existing conversation directly covers the request.',
              rationale: 'The message is directly relevant.',
            },
          ],
          rationale: 'The existing conversation directly covers the request.',
        },
        {
          optionId: 'start-new-conversation',
          kind: 'startNewConversation',
          title: 'Start a fresh goal thread',
          rationale: 'A fresh child conversation remains available.',
          requiresConfirmation: true,
        },
        {
          optionId: 'refine-search',
          kind: 'refineSearch',
          title: 'Refine the search',
          prompt: 'Which goal area should I prioritize?',
          rationale: 'A focused question can narrow the result.',
        },
      ],
    };
    const summary =
      'I found a matching destination with { entityType: CONVERSATION, entityId: UUID }.\n' +
      JSON.stringify(response, null, 2) +
      '\nThe choice remains user-controlled.';
    const poster = makePoster();
    const event = normalizeEvent(
      makeRawAssistantComplete(summary),
      'claude',
    ) as AssistantCompleteEvent;
    const eventTurn = makeTestTurn({
      promptType: LocalPromptType.GoalPm,
      expectedResponseTypes: ['goal_pm_routing_v1'],
    } as unknown as PromptTypeHandler<unknown>);

    await handleAssistantComplete(
      event,
      makeTestRun({ taskId: goalId }),
      makeDeps(poster),
      eventTurn,
    );

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    const dto = outOfBandDto(poster);
    expect(dto).toMatchObject({
      status: MessageStatus.Open,
      data: {
        type: SystemMessageDataTypeEnum.Questions,
        response: 'Choose how to continue.',
        processResponseType: 'goal_pm_routing_v1',
      },
    });
    expect(dto.data?.['response']).not.toContain('goal_pm_routing_v1');
    expect(dto.data?.['uiElements']).toEqual([
      expect.objectContaining({
        type: ExtendedUIFieldType.GoalPmAction,
        promptType: LocalPromptType.GoalPm,
        payload: {
          goalId,
          options: response.options,
        },
      }),
    ]);
  });

  it('keeps an incompatible responseType on the raw prose path instead of invoking a handler transformer', async () => {
    const summary = JSON.stringify({
      responseType: 'startup_plan_v1',
      response: 'This belongs to another handler.',
    });
    const transformOutput = vi.fn(() => ({
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response: 'Incorrectly transformed output.',
        detectedIntent: 'wrong_handler',
        intentConfidence: 1,
      },
    }));
    const handler = {
      promptType: LocalPromptType.TaskRefiner,
      expectedResponseTypes: ['final_assessment_v2'],
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
      transformOutput,
    } as unknown as PromptTypeHandler<unknown>;
    const poster = makePoster();

    await handleAssistantComplete(
      normalizeEvent(makeRawAssistantComplete(summary), 'claude') as AssistantCompleteEvent,
      makeTestRun(),
      makeDeps(poster),
      makeTestTurn(handler),
    );

    expect(transformOutput).not.toHaveBeenCalled();
    expect(outOfBandDto(poster).data).toMatchObject({
      response: summary,
      detectedIntent: 'agent_response',
    });
  });

  it('posts a startup-session follow-up as a normal assistant message without Startup Plan UI', async () => {
    const summary = JSON.stringify({
      responseType: 'startup_plan_v1',
      response: 'Follow-up answer after the startup session.',
    });
    const poster = makePoster();
    const handler = {
      promptType: LocalPromptType.CodingFreeform,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
    } as unknown as PromptTypeHandler<unknown>;

    await handleAssistantComplete(
      normalizeEvent(makeRawAssistantComplete(summary), 'claude') as AssistantCompleteEvent,
      makeTestRun(),
      makeDeps(poster),
      makeTestTurn(handler),
    );

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(outOfBandDto(poster).data).toMatchObject({
      type: SystemMessageDataTypeEnum.Agent,
      response: summary,
      promptHandler: LocalPromptType.CodingFreeform,
    });
    expect(outOfBandDto(poster).data?.['uiElements']).toBeUndefined();
  });

  it('keeps a Coding Plan acknowledgement on the ordinary completed-message path', async () => {
    const summary = 'Your plan is ready for review.';
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const ctx = makeTestRun({
      triggerContext: {
        externalAgentNodeId: 'external-agent-node-1',
        triggerMessageId: 'trigger-msg-1',
      },
      recordPendingCompletion,
    });

    await handleAssistantComplete(
      normalizeEvent(makeRawAssistantComplete(summary), 'claude') as AssistantCompleteEvent,
      ctx,
      makeDeps(poster),
      makeTestTurn(codingPlanHandler as unknown as PromptTypeHandler<unknown>),
    );

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(outOfBandDto(poster)).toMatchObject({
      status: MessageStatus.Completed,
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response: summary,
      },
    });
    expect(outOfBandDto(poster).data?.['responseType']).toBeUndefined();
    expect(outOfBandDto(poster).data?.['uiElements']).toBeUndefined();
    expect(recordPendingCompletion).not.toHaveBeenCalled();
  });

  it('posts only the plan message when a startup_plan_v1 body has no nextAction (first-turn shape)', async () => {
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        {
          stepId: 'step-1',
          title: 'Add endpoint',
          description: 'POST /login',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
    };
    const summary = JSON.stringify(plan);
    const raw = makeRawAssistantComplete(summary);
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({
      triggerContext: {
        externalAgentNodeId: 'external-agent-node-1',
        triggerMessageId: 'trigger-msg-1',
      },
    });
    const deps = makeDeps(poster);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());

    expect(poster.createOutOfBand).toHaveBeenCalledTimes(1);
  });

  it('posts only the plan body inline and records the companion completion for turn-end flush when nextAction=APPROVED', async () => {
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        {
          stepId: 'step-1',
          title: 'Add endpoint',
          description: 'POST /login',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
      nextAction: 'APPROVED',
    };
    const summary = JSON.stringify(plan);
    const raw = makeRawAssistantComplete(summary);
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const ctx = makeTestRun({
      triggerContext: {
        externalAgentNodeId: 'external-agent-node-1',
        triggerMessageId: 'trigger-msg-1',
      },
      recordPendingCompletion,
    });
    const deps = makeDeps(poster);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());

    // The plan body is the only inline tail append. The advancing completion is
    // recorded, not posted — the Run flushes it as the turn's terminal write so
    // it lands after the trailing narrative.
    expect(poster.createOutOfBand).toHaveBeenCalledTimes(1);
    expect(recordPendingCompletion).toHaveBeenCalledTimes(1);
    expect(recordPendingCompletion).toHaveBeenCalledWith({
      action: { action: 'APPROVED' },
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-1',
      userFacingResponse: '',
      stamp: { providerSessionId: 'sess-test-1', promptHandler: 'coding_freeform' },
    });
  });

  it('stamps providerSessionId and promptHandler on the dispatched plan message (startup_plan_v1)', async () => {
    // Structured-response branches resolve via the central dispatcher and
    // produce a Questions-shaped payload — the seam must still merge the
    // Turn-derived stamp onto the data so the persisted plan message records
    // which SDK session and prompt handler emitted it.
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        {
          stepId: 'step-1',
          title: 'Add endpoint',
          description: 'POST /login',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
    };
    const summary = JSON.stringify(plan);
    const raw = makeRawAssistantComplete(summary);
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({ providerSessionId: 'sess-plan-1' });
    const deps = makeDeps(poster);
    const eventTurn = makeTestTurn({
      id: 'startup-session-test',
      promptType: LocalPromptType.StartupSession,
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'gated',
      expectedResponseTypes: ['startup_plan_v1'],
      emitLegacyStartupPlanUiElement: false,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    const dto = outOfBandDto(poster);
    expect(dto.data?.['providerSessionId']).toBe('sess-plan-1');
    expect(dto.data?.['promptHandler']).toBe(LocalPromptType.StartupSession);
  });

  it('records the companion completion with the Turn-derived stamp (JSON-body-terminated turn)', async () => {
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        {
          stepId: 'step-1',
          title: 'Add endpoint',
          description: 'POST /login',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
      nextAction: 'APPROVED',
    };
    const summary = JSON.stringify(plan);
    const raw = makeRawAssistantComplete(summary);
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const ctx = makeTestRun({
      triggerContext: {
        externalAgentNodeId: 'external-agent-node-1',
        triggerMessageId: 'trigger-msg-1',
      },
      providerSessionId: 'sess-jbody-1',
      recordPendingCompletion,
    });
    const deps = makeDeps(poster);
    const eventTurn = makeTestTurn({
      id: 'startup-session-test',
      promptType: LocalPromptType.StartupSession,
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'gated',
      expectedResponseTypes: ['startup_plan_v1'],
      emitLegacyStartupPlanUiElement: false,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    // The stamp is snapshotted at record time so the turn-end flush still
    // attributes the completion to the right SDK session / prompt handler.
    expect(recordPendingCompletion).toHaveBeenCalledTimes(1);
    expect(recordPendingCompletion.mock.calls[0]![0]).toMatchObject({
      stamp: {
        providerSessionId: 'sess-jbody-1',
        promptHandler: LocalPromptType.StartupSession,
      },
    });
  });

  it('records the companion completion with action=REVISED on a REVISED plan', async () => {
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        {
          stepId: 'step-1',
          title: 'Add endpoint',
          description: 'POST /login',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
      nextAction: 'REVISED',
    };
    const summary = JSON.stringify(plan);
    const raw = makeRawAssistantComplete(summary);
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const ctx = makeTestRun({
      triggerContext: {
        externalAgentNodeId: 'external-agent-node-1',
        triggerMessageId: 'trigger-msg-1',
      },
      recordPendingCompletion,
    });
    const deps = makeDeps(poster);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());

    expect(recordPendingCompletion.mock.calls[0]![0]).toMatchObject({
      action: { action: 'REVISED' },
    });
  });

  it('skips the companion completion when triggerContext is not set', async () => {
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        {
          stepId: 'step-1',
          title: 'Add endpoint',
          description: 'POST /login',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
      nextAction: 'APPROVED',
    };
    const summary = JSON.stringify(plan);
    const raw = makeRawAssistantComplete(summary);
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({
      triggerContext: null,
    });
    const deps = makeDeps(poster);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());

    // Companion skipped (no triggerContext); only the plan body is appended.
    expect(poster.createOutOfBand).toHaveBeenCalledTimes(1);
  });

  it('handler does nothing when there is no active turn', async () => {
    const raw = makeRawAssistantComplete('The task is done.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();

    await handleAssistantComplete(event, ctx, deps, null);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
  });

  it('does not attach a Ready-for-Plan button when feature-sync analyze ends with NO_DISCREPANCY', async () => {
    const raw = makeRawAssistantComplete('Feature tree is aligned.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({
      lastSubmissionAction: { action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY },
    });
    const deps = makeDeps(poster);
    const eventTurn = makeTestTurn({
      promptType: LocalPromptType.FeatureSyncAnalyze,
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    const dto = outOfBandDto(poster) as { data?: { secondaryActions?: unknown[] } };
    expect(dto.data?.secondaryActions).toBeUndefined();
  });

  it('does not attach a Ready-for-Plan button when feature-sync iterate ends with REVISED', async () => {
    const raw = makeRawAssistantComplete('Here are the revised discrepancies.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({
      lastSubmissionAction: {
        action: FEATURE_SYNC_ACTIONS.REVISED,
        payload: { discrepancies: [] },
      },
    });
    const deps = makeDeps(poster);
    const eventTurn = makeTestTurn({
      promptType: LocalPromptType.FeatureSyncIterate,
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    const dto = outOfBandDto(poster) as { data?: { secondaryActions?: unknown[] } };
    expect(dto.data?.secondaryActions).toBeUndefined();
  });

  it('does not attach Ready-for-Plan button when feature-sync iterate ends with RESOLVED', async () => {
    const raw = makeRawAssistantComplete('Discrepancies resolved.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({
      lastSubmissionAction: { action: FEATURE_SYNC_ACTIONS.RESOLVED },
    });
    const deps = makeDeps(poster);
    const eventTurn = makeTestTurn({
      promptType: LocalPromptType.FeatureSyncIterate,
    } as PromptTypeHandler<unknown>);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    const dto = outOfBandDto(poster) as { data?: { secondaryActions?: unknown[] } };
    expect(dto.data?.secondaryActions).toBeUndefined();
  });

  it('does not attach Ready-for-Plan button for non-feature-sync turns', async () => {
    const raw = makeRawAssistantComplete('Plain summary.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({
      lastSubmissionAction: null,
    });
    const deps = makeDeps(poster);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());

    const dto = outOfBandDto(poster) as { data?: { secondaryActions?: unknown[] } };
    expect(dto.data?.secondaryActions).toBeUndefined();
  });

  it('handler uses transformOutput from the Turn-captured handler', async () => {
    const raw = makeRawAssistantComplete('The task is done.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);

    const transformOutput = vi.fn().mockReturnValue({
      data: {
        content: 'transformed content',
        uiElements: [{ type: 'final_assessment' }],
      },
    });
    const eventTurn = makeTestTurn({
      promptType: 'coding_prompt',
      transformOutput,
    } as unknown as PromptTypeHandler<unknown>);

    const ctx = makeTestRun();

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    expect(transformOutput).toHaveBeenCalledWith(event);
    // The completion-tail builder supplies the required SYSTEM data
    // discriminator before applying the provider/handler stamp, then marks the
    // turn complete. The handler-authored content remains unchanged.
    expect(poster.createOutOfBand).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: {
        type: MessageType.System,
        status: MessageStatus.Completed,
        projectId: 'proj-1',
        proposalIds: [],
        reportIds: [],
        data: {
          type: SystemMessageDataTypeEnum.Agent,
          content: 'transformed content',
          uiElements: [{ type: 'final_assessment' }],
          actionHint: 'task_complete',
          providerSessionId: 'sess-test-1',
          promptHandler: 'coding_prompt',
        },
      },
      stamp: { providerSessionId: 'sess-test-1', promptHandler: 'coding_prompt' },
    });
  });

  it('records the captured stream text (not event.summary) for an unmatched (free-form) assistant complete', async () => {
    // event.summary and the captured last stream block differ so the assertion
    // proves the recorded value is sourced from the stream, not event.summary.
    const raw = makeRawAssistantComplete('event-summary-payload');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const ctx = makeTestRun({ lastProviderStreamMessage: 'Done. Touched src/foo.ts.' });
    const recordPreviousProviderSession =
      ctx.recordPreviousProviderSession as unknown as ReturnType<typeof vi.fn>;
    const deps = makeDeps(poster);

    const handler: PromptTypeHandler<unknown> = {
      promptType: 'coding_freeform',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
    } as unknown as PromptTypeHandler<unknown>;
    const eventTurn = makeTestTurn(handler);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    expect(recordPreviousProviderSession).toHaveBeenCalledOnce();
    const recorded = recordPreviousProviderSession.mock.calls[0]![0] as {
      promptType: string;
      lastMessage: string;
    };
    expect(recorded.promptType).toBe('coding_freeform');
    expect(recorded.lastMessage).toBe('Done. Touched src/foo.ts.');
  });

  it('records the captured stream text (not the rendered markdown) for a startup_plan_v1 dispatch', async () => {
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        {
          stepId: 'step-1',
          title: 'Add endpoint',
          description: 'POST /login',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
    };
    const raw = makeRawAssistantComplete(JSON.stringify(plan));
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    // The structured JSON drives the posted message; what the user saw in the
    // stream is captured separately and is what gets recorded for the next phase.
    const streamedText = 'Execution plan posted — 1 step across 1 phase.';
    const ctx = makeTestRun({ lastProviderStreamMessage: streamedText });
    const recordPreviousProviderSession =
      ctx.recordPreviousProviderSession as unknown as ReturnType<typeof vi.fn>;
    const deps = makeDeps(poster);

    const handler: PromptTypeHandler<unknown> = {
      promptType: 'startup_session',
      expectedResponseTypes: ['startup_plan_v1'],
      emitLegacyStartupPlanUiElement: false,
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
    } as unknown as PromptTypeHandler<unknown>;
    const eventTurn = makeTestTurn(handler);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    expect(recordPreviousProviderSession).toHaveBeenCalledOnce();
    const recorded = recordPreviousProviderSession.mock.calls[0]![0] as { lastMessage: string };
    // Sourced from the captured stream — not the raw JSON, not the markdown render.
    expect(recorded.lastMessage).toBe(streamedText);
    expect(recorded.lastMessage).not.toContain('"responseType"');
    expect(recorded.lastMessage).not.toContain('Implement auth');
  });

  it('does not record a summary when the completion append throws', async () => {
    const raw = makeRawAssistantComplete('Will fail.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    (poster.createOutOfBand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const ctx = makeTestRun();
    const recordPreviousProviderSession =
      ctx.recordPreviousProviderSession as unknown as ReturnType<typeof vi.fn>;
    const deps = makeDeps(poster);

    const handler: PromptTypeHandler<unknown> = {
      promptType: 'coding_freeform',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
    } as unknown as PromptTypeHandler<unknown>;
    const eventTurn = makeTestTurn(handler);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    expect(recordPreviousProviderSession).not.toHaveBeenCalled();
  });

  it('incident replay: pending-completion envelope carries single-dispatch provenance (nodeId and triggerMessageId from the same stamped pair)', async () => {
    // Regression for the production incident. Pre-fix code stored
    // externalAgentNodeId and triggerMessageId as separate mutable fields; a
    // user-message dispatch that only updated triggerMessageId produced a
    // mixed pair (node-A, msg-B) — old node identity, new trigger identity.
    // The pending-completion path then read both from the same triggerContext
    // object, blindly stamping the mixed pair onto the outgoing envelope.
    //
    // The fix: setTriggerContext is atomic — the pair is always (full, full) or
    // null. A user-message dispatch that finds no pending agent node calls
    // setTriggerContext(null), clearing both fields together. This test drives
    // step 1 of the incident sequence: a node-paired dispatch completes
    // normally and the envelope carries both fields from that single dispatch.
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Audit plan',
      requiredServiceIds: ['service-audit'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        { stepId: 's1', title: 'Step', description: 'desc', phase: 1, references: [] },
      ],
      discrepancies: [],
      clarificationQuestions: [],
      nextAction: 'APPROVED',
    };
    const raw = makeRawAssistantComplete(JSON.stringify(plan));
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    // Run carries the intact pair from the node-paired dispatch. Pre-fix code
    // could leave this as (node-A, msg-B) after a subsequent user-message
    // dispatch that only rotated triggerMessageId.
    const ctx = makeTestRun({
      triggerContext: { externalAgentNodeId: 'node-A', triggerMessageId: 'msg-A' },
      recordPendingCompletion,
    });
    const deps = makeDeps(poster);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());
    const recorded = recordPendingCompletion.mock.calls[0]![0] as {
      action: { action: string };
      externalAgentNodeId: string;
      triggerMessageId: string;
    };
    // Both fields must share dispatch-A provenance. Pre-fix mixed pair:
    // externalAgentNodeId='node-A', triggerMessageId='msg-B'.
    expect(recorded.externalAgentNodeId).toBe('node-A');
    expect(recorded.triggerMessageId).toBe('msg-A');
    expect(recorded.action.action).toBe('APPROVED');
  });

  it('incident replay: cleared-context turn is refused at the pending-completion layer and nothing is posted', async () => {
    // Step 3 of the incident replay: the platform reports no pending agent node
    // (triggerContext cleared to null by setTriggerContext(null)). The
    // pending-completion path must detect the absent context and refuse to post
    // anything. Pre-fix code that posted with a half-populated or stale context
    // would emit a SYSTEM completion message that the workflow engine could
    // spuriously advance.
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Audit plan',
      requiredServiceIds: ['service-audit'],
      primaryImplementations: [
        {
          title: 'Primary implementation',
          content: 'Concrete implementation body.',
          rationale: 'Defines the primary delivered behavior.',
        },
      ],
      executionPlan: [
        { stepId: 's1', title: 'Step', description: 'desc', phase: 1, references: [] },
      ],
      discrepancies: [],
      clarificationQuestions: [],
      nextAction: 'APPROVED',
    };
    const raw = makeRawAssistantComplete(JSON.stringify(plan));
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const ctx = makeTestRun({ triggerContext: null, recordPendingCompletion });
    const deps = makeDeps(poster);

    await handleAssistantComplete(event, ctx, deps, makeTestTurn());

    // Plan message still posts (one tail append) — that is not a completion
    // envelope. With no trigger context there is nothing to complete, so the
    // companion completion is neither recorded nor posted.
    expect(poster.createOutOfBand).toHaveBeenCalledTimes(1);
    expect(recordPendingCompletion).not.toHaveBeenCalled();
    // The handler records the refusal with its specific typed event.
    expect(deps.logger.warn as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'local.handler.assistant_complete.pending_completion_skipped_no_trigger',
      expect.objectContaining({ runId: 'run-1' }),
    );
  });

  it("resolves the originating Turn's handler even when the Run's promptType was overwritten by a later Turn", async () => {
    // Regression: Turn 1 is mid-flight when Turn 2's begin() stamps promptType
    // B on the Run. Turn 1's assistant_complete async chain must still resolve
    // to handler A — read off the captured eventTurn, not the Run's now-stale
    // promptType / registry round-trip.
    const raw = makeRawAssistantComplete('Turn 1 done.');
    const event = normalizeEvent(raw, 'claude') as AssistantCompleteEvent;
    const poster = makePoster();

    const onCompleteA = vi.fn().mockResolvedValue(undefined);
    const transformOutputA = vi.fn().mockReturnValue({
      data: { content: 'A-shaped', uiElements: [] },
    });
    const handlerA: PromptTypeHandler<unknown> = {
      promptType: 'prompt-A',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      buildPrompt: () => '',
      transformOutput: transformOutputA,
      onComplete: onCompleteA,
    } as unknown as PromptTypeHandler<unknown>;

    // Run no longer carries `promptType` — handler resolution comes
    // exclusively from the captured Turn. This assertion still guards the
    // regression: even with no ctx-level promptType, the handler picked is
    // the one on the captured Turn, not one derived by any registry lookup.
    const ctx = makeTestRun();
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiBaseUrl: 'https://example.test',
      logger: deps.logger,
      poster,
    });

    const eventTurn = makeTestTurn(handlerA);

    await handleAssistantComplete(event, ctx, deps, eventTurn);

    // transformOutput from handler A was used, not from whatever prompt-B
    // would have resolved to in a registry lookup.
    expect(transformOutputA).toHaveBeenCalledWith(event);
    expect(poster.createOutOfBand).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: {
        type: MessageType.System,
        status: MessageStatus.Completed,
        projectId: 'proj-1',
        proposalIds: [],
        reportIds: [],
        data: {
          type: SystemMessageDataTypeEnum.Agent,
          content: 'A-shaped',
          uiElements: [],
          actionHint: 'task_complete',
          providerSessionId: 'sess-test-1',
          promptHandler: 'prompt-A',
        },
      },
      stamp: { providerSessionId: 'sess-test-1', promptHandler: 'prompt-A' },
    });
    // onComplete from handler A fires — not skipped because the registry
    // lookup for prompt-B would have missed.
    expect(onCompleteA).toHaveBeenCalledOnce();
  });
});
