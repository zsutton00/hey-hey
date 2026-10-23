import { describe, expect, it, vi } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handleAssistantDelta } from './assistant-delta';
import { makePoster, makeDeps, makeTestRun, makeTestTurn } from './__test-utils';
import type { LocalAgentOutputEvent, AssistantDeltaEvent } from '../types';
import type { PromptTypeHandler } from '../../agents/prompt-type-handler';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { SystemMessageDataTypeEnum } from '../../shared/api/index';
import { createOnCompleteTestDeps } from '../../agents/prompt-type-handler.test-support';

const makeRawAssistantDelta = (summary: string): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'agent_output',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    messageType: 'assistant',
    taskComplete: false,
    summary,
  },
});

describe('assistant_delta end-to-end', () => {
  it('normalizes to AssistantDeltaEvent with summary', () => {
    const event = normalizeEvent(makeRawAssistantDelta('Working on it...'), 'claude');
    expect(event.kind).toBe('assistant_delta');
    expect((event as AssistantDeltaEvent).summary).toBe('Working on it...');
  });

  it('appends a message at the conversation tail', async () => {
    const event = normalizeEvent(
      makeRawAssistantDelta('Working on it...'),
      'claude',
    ) as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();

    await handleAssistantDelta(event, ctx, deps, null);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: expect.objectContaining({
        type: 'SYSTEM',
        data: expect.objectContaining({
          type: 'AGENT',
          response: 'Working on it...',
        }),
      }),
      stamp: null,
    });
  });

  it('appends a raw-text delta even after a submission action has been posted for the turn', async () => {
    const event = normalizeEvent(
      makeRawAssistantDelta('trailing content after DONE'),
      'claude',
    ) as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun({ lastSubmissionAction: { action: 'DONE' } });

    await handleAssistantDelta(event, ctx, deps, null);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
  });

  it('defers a handler-owned terminal envelope to assistant_complete', async () => {
    const summary = JSON.stringify({
      response: 'Implemented the requested change.',
    });
    const event = normalizeEvent(makeRawAssistantDelta(summary), 'claude') as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const handler = {
      promptType: LocalPromptType.Implement,
      isCompletionOutput: () => true,
    } as unknown as PromptTypeHandler<unknown>;

    await handleAssistantDelta(event, makeTestRun(), deps, makeTestTurn(handler));

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(poster.update).not.toHaveBeenCalled();
    expect(deps.logger.debug).toHaveBeenCalledWith(
      'local.handler.assistant_delta.terminal_output_deferred',
      expect.objectContaining({ promptType: LocalPromptType.Implement }),
    );
  });

  it('appends a structured response-type delta as a dispatched message', async () => {
    const planJson = JSON.stringify({
      responseType: 'startup_plan_v1',
      sessionTitle: 'Plan-shaping MCP tools',
      requiredServiceIds: ['service-tools'],
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
          title: 'Do the work',
          description: 'Implement it',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
    });
    const event = normalizeEvent(makeRawAssistantDelta(planJson), 'claude') as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();
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

    await handleAssistantDelta(event, ctx, deps, eventTurn);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: expect.objectContaining({
        type: 'SYSTEM',
        status: 'completed',
        data: expect.objectContaining({
          type: 'AGENT',
          response: 'Your plan is ready.',
          processResponseType: 'startup_plan_v1',
        }),
      }),
      stamp: { providerSessionId: 'sess-test-1', promptHandler: LocalPromptType.StartupSession },
    });
  });

  it('keeps an incompatible responseType as raw narration instead of invoking a handler transformer', async () => {
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

    await handleAssistantDelta(
      normalizeEvent(makeRawAssistantDelta(summary), 'claude') as AssistantDeltaEvent,
      makeTestRun(),
      makeDeps(poster),
      makeTestTurn(handler),
    );

    expect(transformOutput).not.toHaveBeenCalled();
    const dto = (poster.createOutOfBand as ReturnType<typeof import('vitest').vi.fn>).mock
      .calls[0]![0].dto as { data: Record<string, unknown> };
    expect(dto.data['response']).toEqual(expect.stringContaining(`${summary} -- `));
    expect(dto.data['detectedIntent']).toBe('agent_response');
  });

  it('stamps providerSessionId and promptHandler on the appended structured-response delta (startup_plan_v1)', async () => {
    // The delta's structured-response branch produces a report-owned
    // Agent-shaped payload via the central dispatcher; the seam must still merge the
    // Turn-derived stamp onto the data so the persisted plan delta records
    // which SDK session and prompt handler emitted it.
    const planJson = JSON.stringify({
      responseType: 'startup_plan_v1',
      sessionTitle: 't',
      requiredServiceIds: ['service-tools'],
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
          title: 'Do the work',
          description: 'Implement it',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
    });
    const event = normalizeEvent(makeRawAssistantDelta(planJson), 'claude') as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun({ providerSessionId: 'sess-delta-1' });
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

    await handleAssistantDelta(event, ctx, deps, eventTurn);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    const oobArgs = (poster.createOutOfBand as ReturnType<typeof import('vitest').vi.fn>).mock
      .calls[0]!;
    const dto = oobArgs[0].dto as { data: Record<string, unknown> };
    expect(dto.data['providerSessionId']).toBe('sess-delta-1');
    expect(dto.data['promptHandler']).toBe(LocalPromptType.StartupSession);
  });

  it('coalesces a refiner transformOutput delta as its own row, not into the interstitial', async () => {
    // transformOutput producing structured data (a proposal carrier) stays a
    // standalone appended row — it is not generic narration.
    const event = normalizeEvent(
      makeRawAssistantDelta('done refining'),
      'claude',
    ) as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();
    const turn = makeTestTurn({
      promptType: LocalPromptType.StartupSession,
      expectedResponseTypes: ['startup_plan_v1'],
      emitLegacyStartupPlanUiElement: false,
      transformOutput: () => ({
        data: {
          type: 'AGENT',
          response: 'Refined.',
          detectedIntent: 'task_refiner',
          intentConfidence: 1,
          ragEnabled: false,
        },
      }),
    } as unknown as PromptTypeHandler<unknown>);

    await handleAssistantDelta(event, ctx, deps, turn);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.update).not.toHaveBeenCalled();
    const dto = (poster.createOutOfBand as ReturnType<typeof import('vitest').vi.fn>).mock
      .calls[0]![0].dto as { data: Record<string, unknown> };
    expect(dto.data['uiElements']).toBeUndefined();
    expect(ctx.claimNarration).not.toHaveBeenCalled();
  });

  it('appends a structured response-type delta even after a submission action', async () => {
    // The plan JSON was emitted before submit_revised but the runner buffers
    // it and flushes it after the tool call — we must still append it so the
    // plan appears in the conversation.
    const planJson = JSON.stringify({
      responseType: 'startup_plan_v1',
      sessionTitle: 't',
      requiredServiceIds: ['service-tools'],
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
          title: 'Do the work',
          description: 'Implement it',
          phase: 1,
          references: [],
        },
      ],
      discrepancies: [],
      clarificationQuestions: [],
    });
    const event = normalizeEvent(makeRawAssistantDelta(planJson), 'claude') as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun({ lastSubmissionAction: { action: 'REVISED' } });

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

    await handleAssistantDelta(event, ctx, deps, eventTurn);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
  });
});

describe('assistant_delta coalesced narration', () => {
  const plainHandler = {
    promptType: LocalPromptType.StartupSession,
  } as PromptTypeHandler<unknown>;

  const oobCalls = (poster: ReturnType<typeof makePoster>) =>
    (poster.createOutOfBand as ReturnType<typeof import('vitest').vi.fn>).mock.calls;
  const updateCalls = (poster: ReturnType<typeof makePoster>) =>
    (poster.update as ReturnType<typeof import('vitest').vi.fn>).mock.calls;

  it('authors one interstitial row on the first narration segment', async () => {
    const event = normalizeEvent(
      makeRawAssistantDelta('First segment.'),
      'claude',
    ) as AssistantDeltaEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    try {
      await handleAssistantDelta(event, ctx, deps, makeTestTurn(plainHandler));
    } finally {
      vi.useRealTimers();
    }

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.update).not.toHaveBeenCalled();
    const dto = oobCalls(poster)[0]![0].dto as {
      status: string;
      data: Record<string, unknown>;
    };
    expect(dto.data['response']).toBe('First segment. -- 2025-01-01T00:00:00.000Z');
    expect(dto.data['ragEnabled']).toBe(false);
    expect(dto.data['uiElements']).toEqual([
      { id: 'interstitial', type: 'interstitial', label: '' },
    ]);
  });

  it('updates the same row in place with the concatenated body for later segments', async () => {
    const poster = makePoster();
    const fetchImpl = vi.fn();
    const deps = makeDeps(poster);
    deps.onCompleteDeps = createOnCompleteTestDeps({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: deps.logger,
      poster,
    });
    const ctx = makeTestRun();
    const turn = makeTestTurn(plainHandler);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
      await handleAssistantDelta(
        normalizeEvent(makeRawAssistantDelta('A'), 'claude') as AssistantDeltaEvent,
        ctx,
        deps,
        turn,
      );
      vi.setSystemTime(new Date('2025-01-01T00:00:01.000Z'));
      await handleAssistantDelta(
        normalizeEvent(makeRawAssistantDelta('B'), 'claude') as AssistantDeltaEvent,
        ctx,
        deps,
        turn,
      );
    } finally {
      vi.useRealTimers();
    }

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.update).toHaveBeenCalledOnce();
    const [organizationId, projectId, messageId, data] = updateCalls(poster)[0]!;
    expect(organizationId).toBe('org-1');
    expect(projectId).toBe('proj-1');
    expect(messageId).toBe('oob-msg-1'); // the row created by the first segment
    const updateData = data as { data: Record<string, unknown> };
    expect(updateData.data['response']).toBe(
      'A -- 2025-01-01T00:00:00.000Z\n\n──────────\n\nB -- 2025-01-01T00:00:01.000Z',
    );
    expect(updateData.data['ragEnabled']).toBe(false);
    expect(updateData.data['uiElements']).toEqual([
      { id: 'interstitial', type: 'interstitial', label: '' },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('starts a fresh row for a subsequent Turn in the same Run', async () => {
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
      await handleAssistantDelta(
        normalizeEvent(makeRawAssistantDelta('turn one'), 'claude') as AssistantDeltaEvent,
        ctx,
        deps,
        makeTestTurn(plainHandler, 'turn-1'),
      );
      vi.setSystemTime(new Date('2025-01-01T00:00:01.000Z'));
      await handleAssistantDelta(
        normalizeEvent(makeRawAssistantDelta('turn two'), 'claude') as AssistantDeltaEvent,
        ctx,
        deps,
        makeTestTurn(plainHandler, 'turn-2'),
      );
    } finally {
      vi.useRealTimers();
    }

    expect(poster.createOutOfBand).toHaveBeenCalledTimes(2);
    expect(poster.update).not.toHaveBeenCalled();
    expect((oobCalls(poster)[0]![0].dto.data as Record<string, unknown>)['response']).toBe(
      'turn one -- 2025-01-01T00:00:00.000Z',
    );
    expect((oobCalls(poster)[1]![0].dto.data as Record<string, unknown>)['response']).toBe(
      'turn two -- 2025-01-01T00:00:01.000Z',
    );
  });
});
