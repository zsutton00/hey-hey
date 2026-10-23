import { describe, expect, it, vi } from 'vitest';
import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import type { LocalGoalPmPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  createPromptTypeHandlerTestDeps,
  createPromptTypeHandlerTestAuth,
} from '../prompt-type-handler.test-support';
import { GoalPmHandler } from './goal-pm.handler';

const GOAL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_GOAL_ID = '22222222-2222-4222-8222-222222222222';
const FEATURE_ID = '33333333-3333-4333-8333-333333333333';
const GOAL_PM_CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';
const ELIGIBLE_CONVERSATION_ID = '55555555-5555-4555-8555-555555555555';
const UNRELATED_CONVERSATION_ID = '66666666-6666-4666-8666-666666666666';
const ACTIVE_CONVERSATION_ID = '77777777-7777-4777-8777-777777777777';

const makeCanonicalGoalResponse = (type = 'GOAL', id = GOAL_ID): Response =>
  new Response(
    JSON.stringify({
      data: {
        id,
        name: 'Improve goal planning',
        type,
        status: 'ACTIVE',
        sections: [
          {
            key: 'description',
            materializedMarkdown: 'Make goal work easier to find and organize.',
          },
          {
            key: 'acceptanceCriteria',
            materializedMarkdown: 'Users can route a goal request to the right destination.',
          },
        ],
        dueDate: '2026-12-01T00:00:00Z',
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'goal-pm-run-1',
    entity: { entityType: 'TASK', entityId: GOAL_ID },
    contextMetadata: {
      capturedAt: '2026-09-03T00:00:00Z',
      organizationId: 'organization-1',
      projectId: 'project-1',
      agentSessionId: 'goal-pm-run-1',
    },
    sessionContext: {},
    ...overrides,
  }) as AgenticSession;

const makeCompletion = (response: object): AssistantCompleteEvent => ({
  kind: 'assistant_complete',
  runId: 'goal-pm-run-1',
  source: 'provider',
  eventType: 'assistant_complete',
  timestamp: '2026-09-03T00:00:01Z',
  sessionId: 'provider-session-1',
  agentId: 'goal_pm',
  payload: {},
  summary: JSON.stringify(response),
});

const startNewOption = {
  optionId: 'start-new',
  kind: 'startNewConversation',
  title: 'New discussion',
  rationale: 'A new discussion remains available.',
  requiresConfirmation: true,
};

const refineSearchOption = {
  optionId: 'refine-search',
  kind: 'refineSearch',
  title: 'Refine the search',
  prompt: 'Which area should I prioritize?',
  rationale: 'A narrower request can distinguish the conversations.',
};

const makePayload = (overrides: Partial<LocalGoalPmPromptPayload> = {}): LocalGoalPmPromptPayload =>
  ({
    entity: {
      entityType: 'TASK',
      entityId: GOAL_ID,
      taskType: 'GOAL',
      title: 'Improve goal planning',
      description: 'Make goal work easier to find and organize.',
      acceptanceCriteria: 'Users can route a goal request to the right destination.',
      dueDate: '2026-12-01T00:00:00Z',
    },
    userMessage: 'Find the best place for this request.',
    activeConversationId: ACTIVE_CONVERSATION_ID,
    conversationInventory: [
      {
        conversationId: GOAL_PM_CONVERSATION_ID,
        title: 'Goal PM',
        owner: { entityType: 'TASK', entityId: GOAL_ID, taskType: 'GOAL' },
        workflowName: 'goal-pm',
      },
      {
        conversationId: ELIGIBLE_CONVERSATION_ID,
        title: 'Launch planning',
        owner: { entityType: 'TASK', entityId: GOAL_ID, taskType: 'GOAL' },
        workflowName: 'entity-conversation',
      },
      {
        conversationId: UNRELATED_CONVERSATION_ID,
        title: 'Another goal discussion',
        owner: { entityType: 'TASK', entityId: OTHER_GOAL_ID, taskType: 'GOAL' },
        workflowName: 'entity-conversation',
      },
    ],
    ...overrides,
  }) as LocalGoalPmPromptPayload;

const makeDeps = (
  fetchImpl: typeof fetch = vi.fn().mockResolvedValue(makeCanonicalGoalResponse()) as typeof fetch,
): PromptTypeHandlerDeps =>
  createPromptTypeHandlerTestDeps({
    fetchImpl,
    auth: createPromptTypeHandlerTestAuth('goal-pm-token'),
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as unknown as PromptTypeHandlerDeps['logger'],
  });

describe('GoalPmHandler', () => {
  it('declares a fresh, read-only research session with no mutation tools', () => {
    const handler = new GoalPmHandler();

    expect(handler.id).toBe('goal_pm');
    expect(handler.promptType).toBe('goal_pm');
    expect(handler.expectedResponseTypes).toEqual(['goal_pm_routing_v1']);
    expect(handler.mcpToolUseCase).toBe('research');
    expect(handler.builtinTools).toEqual([]);
    expect(handler.readOnlyFilesystem).toBe(true);
    expect(handler.providerSessionLifetime).toBe('turn');
    expect(handler.providerSessionStart).toBe('fresh');
    expect(handler.rebuildPromptOnUserMessage).toBe(true);
    expect('additionalAllowedTools' in handler).toBe(false);
    expect('submissionTools' in handler).toBe(false);
  });

  it('prepares an undated Goal without inventing a target date', async () => {
    const body = await makeCanonicalGoalResponse().json();
    body.data.dueDate = null;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await new GoalPmHandler().prepare!(
      makeSession(),
      makePayload(),
      makeDeps(fetchImpl),
    );
    expect(result.payload.entity.dueDate).toBeUndefined();
    expect(result.sessionContext?.['goalPm.scope']).not.toHaveProperty('dueDate');
  });

  it('verifies canonical GOAL task scope and persists it for follow-up routing', async () => {
    const handler = new GoalPmHandler();
    const result = await handler.prepare!(makeSession(), makePayload(), makeDeps());

    expect(result.payload.entity).toMatchObject({
      entityType: 'TASK',
      entityId: GOAL_ID,
      taskType: 'GOAL',
    });
    expect(result.sessionContext).toEqual({
      'goalPm.scope': {
        entityId: GOAL_ID,
        taskType: 'GOAL',
        title: 'Improve goal planning',
        description: 'Make goal work easier to find and organize.',
        acceptanceCriteria: 'Users can route a goal request to the right destination.',
        dueDate: '2026-12-01T00:00:00Z',
      },
      'goalPm.conversationInventory': [
        {
          conversationId: ELIGIBLE_CONVERSATION_ID,
          title: 'Launch planning',
          owner: { entityType: 'TASK', entityId: GOAL_ID, taskType: 'GOAL' },
          workflowName: 'entity-conversation',
        },
      ],
    });

    const followUpPayload = {
      userMessage: 'Continue with the existing discussion.',
    } as LocalGoalPmPromptPayload;
    const followUpFetch = vi.fn().mockResolvedValue(makeCanonicalGoalResponse()) as typeof fetch;
    const followUp = await handler.prepare!(
      makeSession(result.sessionContext ? { sessionContext: result.sessionContext } : undefined),
      followUpPayload,
      makeDeps(followUpFetch),
    );
    expect(followUpFetch).toHaveBeenCalledTimes(1);
    expect(followUp.payload.entity).toMatchObject({
      entityType: 'TASK',
      entityId: GOAL_ID,
      taskType: 'GOAL',
      title: 'Improve goal planning',
    });
    expect(followUp.payload.conversationInventory).toEqual(result.payload.conversationInventory);
  });

  it('rejects a payload that claims GOAL when the authoritative task is not a GOAL', async () => {
    const handler = new GoalPmHandler();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeCanonicalGoalResponse('STANDARD')) as typeof fetch;

    await expect(
      handler.prepare!(makeSession(), makePayload(), makeDeps(fetchImpl)),
    ).rejects.toThrow(/persisted TASK to be a canonical GOAL/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an archived authoritative goal', async () => {
    const handler = new GoalPmHandler();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: GOAL_ID,
            name: 'Archived goal',
            type: 'GOAL',
            status: 'ARCHIVED',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as typeof fetch;

    await expect(
      handler.prepare!(makeSession(), makePayload(), makeDeps(fetchImpl)),
    ).rejects.toThrow(/cannot use an archived GOAL/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, non-task, non-goal, and conflicting scope', async () => {
    const handler = new GoalPmHandler();

    await expect(
      handler.prepare!(makeSession({ entity: null }), makePayload(), makeDeps()),
    ).rejects.toThrow(/persisted TASK Run entity/);
    await expect(
      handler.prepare!(
        makeSession({ entity: { entityType: 'PROJECT', entityId: GOAL_ID } }),
        makePayload(),
        makeDeps(),
      ),
    ).rejects.toThrow(/persisted TASK Run entity/);
    await expect(
      handler.prepare!(
        makeSession(),
        makePayload({ entity: { ...makePayload().entity, taskType: 'STANDARD' } as never }),
        makeDeps(),
      ),
    ).rejects.toThrow(/GOAL TASK/);
    await expect(
      handler.prepare!(
        makeSession(),
        makePayload({
          entity: { ...makePayload().entity, entityId: OTHER_GOAL_ID },
        }),
        makeDeps(),
      ),
    ).rejects.toThrow(/conflicts with the persisted Run entity/);
  });

  it('requires durable scope when a follow-up omits the launch entity', async () => {
    const handler = new GoalPmHandler();
    const followUpPayload = { userMessage: 'Where should this go?' } as LocalGoalPmPromptPayload;

    await expect(handler.prepare!(makeSession(), followUpPayload, makeDeps())).rejects.toThrow(
      /durable GOAL scope/,
    );
    await expect(
      handler.prepare!(
        makeSession({
          sessionContext: {
            'goalPm.scope': { entityId: FEATURE_ID, taskType: 'GOAL' },
          },
        }),
        followUpPayload,
        makeDeps(),
      ),
    ).rejects.toThrow(/durable GOAL scope/);
  });

  it('builds a routing-only prompt and injects the user message separately', async () => {
    const handler = new GoalPmHandler();
    const payload = (await handler.prepare!(makeSession(), makePayload(), makeDeps())).payload;
    const prompt = handler.buildPrompt(payload);

    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('discovery, clarification, and routing');
    expect(prompt).toContain('unified_search');
    expect(prompt).toContain(ELIGIBLE_CONVERSATION_ID);
    expect(prompt).toContain('Launch planning');
    expect(prompt).not.toContain(GOAL_PM_CONVERSATION_ID);
    expect(prompt).not.toContain(UNRELATED_CONVERSATION_ID);
    expect(prompt).toContain('never a structural parent of work');
    expect(prompt).toContain('proposal approval');
    expect(prompt).toContain('"options": [');
    expect(prompt).toContain('"evidence": [');
    expect(prompt).toContain('"conversationId":');
    expect(prompt).toContain('Do not emit a bare conversationId');
    expect(prompt).not.toContain(payload.userMessage);
    expect(handler.addUserMessage(payload)).toContain(payload.userMessage);
  });

  it('offers only start-new when no substantive conversation remains', async () => {
    const handler = new GoalPmHandler();
    const prepared = await handler.prepare!(
      makeSession(),
      makePayload({
        conversationInventory: [makePayload().conversationInventory[0]!],
      }),
      makeDeps(),
    );
    const prompt = handler.buildPrompt(prepared.payload);

    expect(prepared.payload.conversationInventory).toEqual([]);
    expect(prompt).toContain(
      'Return exactly one startNewConversation option and no other options.',
    );
    expect(prompt).not.toContain('"kind": "refineSearch"');
    expect(prompt).not.toContain('"kind": "existingConversation"');
    expect(prompt).not.toContain('"kind": "trackExistingWork"');
    expect(prompt).not.toContain('"kind": "createMissingWork"');
    expect(prompt).not.toContain('"kind": "proposal"');
    expect(prompt).not.toContain('offer an explicit alternative');
    expect(prompt).not.toContain('Existing work requires explicit selection');
  });

  it('rejects completion destinations outside the prepared goal inventory', async () => {
    const handler = new GoalPmHandler();
    const payload = (await handler.prepare!(makeSession(), makePayload(), makeDeps())).payload;
    const result = handler.validateCompletion(
      makeCompletion({
        responseType: 'goal_pm_routing_v1',
        goalId: GOAL_ID,
        options: [
          {
            optionId: 'unrelated-conversation',
            kind: 'existingConversation',
            conversationId: UNRELATED_CONVERSATION_ID,
            title: 'Another goal discussion',
            evidence: [
              {
                messageId: '88888888-8888-4888-8888-888888888888',
                excerpt: 'Unrelated evidence.',
                rationale: 'This must not escape its owning goal.',
              },
            ],
            rationale: 'Topically similar but owned by another goal.',
          },
          startNewOption,
          refineSearchOption,
        ],
      }),
      payload,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('outside the active goal inventory') },
    });
  });

  it('requires only start-new for an empty prepared inventory', async () => {
    const handler = new GoalPmHandler();
    const payload = (
      await handler.prepare!(makeSession(), makePayload({ conversationInventory: [] }), makeDeps())
    ).payload;
    const response = {
      responseType: 'goal_pm_routing_v1',
      goalId: GOAL_ID,
      options: [startNewOption],
    };

    expect(handler.validateCompletion(makeCompletion(response), payload)).toEqual({ ok: true });
    expect(
      handler.validateCompletion(
        makeCompletion({
          ...response,
          options: [
            startNewOption,
            {
              optionId: 'existing-proposal',
              kind: 'proposal',
              proposalId: '99999999-9999-4999-8999-999999999999',
              title: 'Relevant proposal',
              rationale: 'The proposal is related to the goal request.',
              requiresSelection: true,
            },
          ],
        }),
        payload,
      ),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('only startNewConversation') },
    });
    expect(
      handler.validateCompletion(
        makeCompletion({ ...response, options: [startNewOption, refineSearchOption] }),
        payload,
      ),
    ).toMatchObject({ ok: false });
  });

  it('requires refine-search when the prepared inventory has eligible conversations', async () => {
    const handler = new GoalPmHandler();
    const payload = (await handler.prepare!(makeSession(), makePayload(), makeDeps())).payload;
    const result = handler.validateCompletion(
      makeCompletion({
        responseType: 'goal_pm_routing_v1',
        goalId: GOAL_ID,
        options: [startNewOption],
      }),
      payload,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('one refineSearch option') },
    });
  });
});
