import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ExtendedUIFieldType } from '../shared/api/index';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import {
  dispatchResponseType,
  requiresNodeId,
  resolveResponseDispatchContext,
} from './response-dispatch';

const fixturesDir = join(__dirname, '__fixtures__');

const makeLogger = (): ServerLogger => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => NOOP_LOGGER),
});

const ALL_RESPONSE_TYPES = [
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
  'implementation_readiness_v1',
] as const;

const dispatchContext = (
  taskId: string | null,
  expectedResponseTypes: readonly (typeof ALL_RESPONSE_TYPES)[number][] = ALL_RESPONSE_TYPES,
  emitLegacyStartupPlanUiElement = true,
  currentWorkflowNodeId: string | null = null,
) => ({
  taskId,
  promptType: 'test',
  currentWorkflowNodeId,
  expectedResponseTypes,
  emitLegacyStartupPlanUiElement,
});

describe('dispatchResponseType', () => {
  it('declares which response types require a live workflow node', () => {
    expect(requiresNodeId('implementation_readiness_v1')).toBe(true);
    expect(requiresNodeId('final_assessment_v2')).toBe(false);
    expect(requiresNodeId(null)).toBe(false);
  });

  it('resolves node metadata only for compatible response types', async () => {
    const resolveNodeId = vi.fn().mockResolvedValue('feature-sync-implementation-readiness-review');
    const context = dispatchContext(null);

    const resolved = await resolveResponseDispatchContext(
      '```json\n{"responseType":"implementation_readiness_v1"}\n```',
      context,
      resolveNodeId,
    );

    expect(resolved).toMatchObject({
      currentWorkflowNodeId: 'feature-sync-implementation-readiness-review',
    });
    expect(resolveNodeId).toHaveBeenCalledOnce();
  });

  it('does not resolve node metadata for unrelated response types', async () => {
    const resolveNodeId = vi.fn().mockResolvedValue('unused-node');
    const context = dispatchContext(null);

    const resolved = await resolveResponseDispatchContext(
      '```json\n{"responseType":"final_assessment_v2"}\n```',
      context,
      resolveNodeId,
    );

    expect(resolved).toBe(context);
    expect(resolveNodeId).not.toHaveBeenCalled();
  });

  it('returns { matched: false } for summaries with no responseType marker', () => {
    const result = dispatchResponseType('Just a plain summary', dispatchContext(null), NOOP_LOGGER);
    expect(result.matched).toBe(false);
  });

  it('parses a final_assessment_v2 JSON blob preceded by narrative prose', () => {
    const json = JSON.stringify({
      responseType: 'final_assessment_v2',
      taskAssessment: {
        target: { entityType: 'task', entityId: 'task-1' },
        verdict: 'completed',
        statusRecommendation: { status: 'COMPLETED', reason: 'All checks pass' },
        summary: 'Task is done.',
      },
      hierarchyWalk: [
        {
          entityType: 'task',
          entityId: 'task-1',
          name: 'The task',
          distance: 0,
          action: 'no_update',
          rationale: 'primary target',
        },
      ],
    });
    const summary = `Here is my final assessment.\n\n\`\`\`json\n${json}\n\`\`\``;

    const result = dispatchResponseType(summary, dispatchContext('task-1'), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.responseType).toBe('final_assessment_v2');
    const uiElements = (result.updateData.data as { uiElements?: unknown[] }).uiElements;
    expect(Array.isArray(uiElements)).toBe(true);
    expect(uiElements?.length).toBe(1);
    expect(result.sideEffects).toHaveLength(0);
  });

  it('parses an agent_search_results_v1 response into an AgentSearchResults UI element carrying the results array', () => {
    const results = [
      { entityType: 'TASK', entityId: 'task-1', title: 'First hit', reason: 'matches the query' },
      {
        entityType: 'DESIGN_DOC',
        entityId: 'doc-1',
        title: 'Second hit',
        reason: 'related design doc',
      },
    ];
    const json = JSON.stringify({
      responseType: 'agent_search_results_v1',
      response: 'Found two relevant entities.',
      results,
    });
    const summary = `Here are the results.\n\n\`\`\`json\n${json}\n\`\`\``;

    const result = dispatchResponseType(summary, dispatchContext(null), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.responseType).toBe('agent_search_results_v1');
    const data = result.updateData.data as {
      response?: string;
      uiElements?: { type?: string; payload?: unknown }[];
    };
    expect(data.response).toBe('Found two relevant entities.');
    expect(data.uiElements?.length).toBe(1);
    expect(data.uiElements?.[0]?.type).toBe(ExtendedUIFieldType.AgentSearchResults);
    expect(data.uiElements?.[0]?.payload).toEqual(results);
    expect(result.pendingCompletion).toBeNull();
  });

  it('maps an implementation-readiness review into the read-only field and bounded actions', () => {
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
          affectedSourceContext: 'The Open task and its Project Assistant memo',
          unresolvedDecision: 'Which service owns the persisted readiness disposition?',
          consequentialInventionRisk: 'Coding would otherwise invent the observable behavior.',
          boundedEvidence: [
            {
              category: 'behavior',
              statement: 'The task names a consumer but leaves the observable outcome open.',
              sourceRef: 'Project Assistant memo',
            },
          ],
          answerKind: 'Name the authoritative owner and persistence boundary.',
        },
        resolution: { kind: 'NONE' },
      },
    };

    const result = dispatchResponseType(
      `The request needs one decision.\n\n\`\`\`json\n${JSON.stringify(response)}\n\`\`\``,
      dispatchContext(
        null,
        ALL_RESPONSE_TYPES,
        true,
        'feature-sync-implementation-readiness-review',
      ),
      NOOP_LOGGER,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.responseType).toBe('implementation_readiness_v1');
    expect(result.pendingCompletion).toBeNull();

    const data = result.updateData.data as {
      type?: string;
      status?: string;
      processResponseType?: string;
      uiElements?: Array<{ type?: string; payload?: unknown; id?: string }>;
      secondaryActions?: Array<{
        label?: string;
        fieldId?: string;
        payload?: { runId?: string; sourceRevision?: string; confirmed?: boolean };
      }>;
    };
    expect(data.type).toBe('QUESTIONS');
    expect(data.status).toBeUndefined();
    expect(data.processResponseType).toBe('implementation_readiness_v1');
    expect((data as { nodeId?: string }).nodeId).toBe(
      'feature-sync-implementation-readiness-review',
    );
    expect(data.uiElements).toHaveLength(1);
    expect(data.uiElements?.[0]).toMatchObject({
      type: ExtendedUIFieldType.ImplementationReadiness,
      payload: response,
    });
    expect(data.secondaryActions?.map((action) => action.label)).toEqual(['Clarify', 'Dismiss']);
    expect(data.secondaryActions).toHaveLength(2);
    for (const action of data.secondaryActions ?? []) {
      expect(action.fieldId).toBe(data.uiElements?.[0]?.id);
      expect(action.payload).toMatchObject({
        runId: 'run-open-1',
        sourceRevision: 'sha256:open-source-revision',
      });
    }
    expect(data.secondaryActions?.[1]?.payload?.confirmed).toBe(true);
  });

  it.each([
    {
      name: 'an existing conversation with message evidence',
      option: {
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
    },
    {
      name: 'a new conversation',
      option: {
        optionId: 'start-new-conversation',
        kind: 'startNewConversation',
        title: 'Goal routing follow-up',
        rationale: 'No existing conversation matches the request.',
        requiresConfirmation: true,
      },
    },
    {
      name: 'a refine-search alternative',
      option: {
        optionId: 'refine-search',
        kind: 'refineSearch',
        title: 'Refine the search',
        prompt: 'Which goal area should I prioritize?',
        rationale: 'A focused question could distinguish the choices.',
      },
    },
    {
      name: 'existing task work',
      option: {
        optionId: 'track-existing-task',
        kind: 'trackExistingWork',
        target: {
          entityType: 'TASK',
          entityId: '55555555-5555-4555-8555-555555555555',
          title: 'Goal work item',
        },
        rationale: 'The eligible task already delivers this slice of the goal.',
        requiresSelection: true,
      },
    },
    {
      name: 'existing plan work',
      option: {
        optionId: 'track-existing-plan',
        kind: 'trackExistingWork',
        target: {
          entityType: 'PLAN',
          entityId: '66666666-6666-4666-8666-666666666666',
          title: 'Goal work plan',
        },
        rationale: 'The plan already delivers this slice of the goal.',
        requiresSelection: true,
      },
    },
    {
      name: 'missing work',
      option: {
        optionId: 'create-missing-work',
        kind: 'createMissingWork',
        parentFeatureId: '77777777-7777-4777-8777-777777777777',
        workItemType: 'TASK',
        title: 'Create goal work item',
        description: 'Add the missing work under the correct feature.',
        acceptanceCriteria: 'The proposed task is reviewable and goal-tracked after selection.',
        authoringMode: 'PROPOSAL',
        rationale: 'Search found no existing eligible work.',
        requiresSelection: true,
      },
    },
    {
      name: 'a proposal destination',
      option: {
        optionId: 'proposal-review',
        kind: 'proposal',
        proposalId: '88888888-8888-4888-8888-888888888888',
        title: 'Goal proposal review',
        rationale: 'A pending proposal discussion may be the intended destination.',
        requiresSelection: true,
      },
    },
  ] as const)('maps $name into one typed Goal PM UI option without side effects', ({ option }) => {
    const requiredEscapeOptions = [
      ...(option.kind === 'startNewConversation'
        ? []
        : [
            {
              optionId: 'required-start-new',
              kind: 'startNewConversation',
              title: 'Start a fresh goal thread',
              rationale: 'A fresh child conversation remains available.',
              requiresConfirmation: true,
            },
          ]),
      ...(option.kind === 'refineSearch'
        ? []
        : [
            {
              optionId: 'required-refine-search',
              kind: 'refineSearch',
              title: 'Refine the search',
              prompt: 'Which goal area should I prioritize?',
              rationale: 'A focused question can narrow the result.',
            },
          ]),
    ];
    const response = {
      responseType: 'goal_pm_routing_v1',
      goalId: '11111111-1111-4111-8111-111111111111',
      options: [option, ...requiredEscapeOptions],
    };

    const result = dispatchResponseType(
      JSON.stringify(response),
      dispatchContext(response.goalId),
      NOOP_LOGGER,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.responseType).toBe('goal_pm_routing_v1');
    expect(result.sideEffects).toEqual([]);
    expect(result.pendingCompletion).toBeNull();
    const data = result.updateData.data as {
      processResponseType?: string;
      uiElements?: Array<{
        type?: string;
        promptType?: string;
        payload?: { goalId?: string; options?: unknown };
      }>;
    };
    expect(data.processResponseType).toBe('goal_pm_routing_v1');
    expect(data.uiElements?.[0]).toMatchObject({
      type: ExtendedUIFieldType.GoalPmAction,
      promptType: 'goal_pm',
      payload: { goalId: response.goalId, options: response.options },
    });
  });

  it('maps a pretty-printed Goal PM completion after preamble object syntax to one typed field', () => {
    const response = {
      responseType: 'goal_pm_routing_v1',
      goalId: '11111111-1111-4111-8111-111111111111',
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
      'The candidate has shape { entityType: CONVERSATION, entityId: UUID }.\n' +
      JSON.stringify(response, null, 2) +
      '\nChoose only after reviewing the evidence.';

    const result = dispatchResponseType(summary, dispatchContext(response.goalId), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.updateData.data).toMatchObject({
      type: 'QUESTIONS',
      response: 'Choose how to continue.',
      processResponseType: 'goal_pm_routing_v1',
    });
    const data = result.updateData.data as {
      uiElements?: Array<{ type?: string; payload?: unknown }>;
    };
    expect(data.uiElements).toHaveLength(1);
    expect(data.uiElements?.[0]).toMatchObject({
      type: ExtendedUIFieldType.GoalPmAction,
      payload: { goalId: response.goalId, options: response.options },
    });
  });

  it('rejects a Goal PM recommendation with duplicate option identities', () => {
    const result = dispatchResponseType(
      JSON.stringify({
        responseType: 'goal_pm_routing_v1',
        goalId: '11111111-1111-4111-8111-111111111111',
        options: [
          {
            optionId: 'same-option',
            kind: 'refineSearch',
            title: 'Refine the search',
            prompt: 'Which goal area should I prioritize?',
            rationale: 'A focused question could distinguish the choices.',
          },
          {
            optionId: 'same-option',
            kind: 'startNewConversation',
            title: 'Start a fresh thread',
            rationale: 'A fresh child conversation remains available.',
            requiresConfirmation: true,
          },
        ],
      }),
      dispatchContext('11111111-1111-4111-8111-111111111111'),
      NOOP_LOGGER,
    );

    expect(result.matched).toBe(false);
  });

  it('rejects a Goal PM response whose goal is outside the active TASK scope', () => {
    const result = dispatchResponseType(
      JSON.stringify({
        responseType: 'goal_pm_routing_v1',
        goalId: '11111111-1111-4111-8111-111111111111',
        options: [
          {
            optionId: 'existing-conversation',
            kind: 'existingConversation',
            conversationId: '33333333-3333-4333-8333-333333333333',
            title: 'Existing goal discussion',
            evidence: [
              {
                messageId: '44444444-4444-4444-8444-444444444444',
                excerpt: 'This conversation matches the request.',
                rationale: 'The message is directly relevant.',
              },
            ],
            rationale: 'This conversation matches the request.',
          },
        ],
      }),
      dispatchContext('22222222-2222-4222-8222-222222222222'),
      NOOP_LOGGER,
    );

    expect(result.matched).toBe(false);
  });

  it('parses a startup_plan_v1 response into a CodingPromptStartupPlan UI element', () => {
    const plan = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Login endpoint',
          content: 'POST /login',
          rationale: 'Defines the primary delivered behavior.',
          connections: [
            {
              entityType: 'contract',
              entityId: '22222222-2222-4222-8222-222222222222',
              entityTitle: 'Login contract',
              relationship: 'enforces',
              sourceField: 'sections.guarantee',
              sourceExcerpt: 'Login returns a session for valid credentials.',
              rationale: 'The endpoint enforces this guarantee.',
            },
          ],
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

    const result = dispatchResponseType(summary, dispatchContext(null), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.responseType).toBe('startup_plan_v1');
    expect(result.sideEffects).toHaveLength(0);
    expect(result.pendingCompletion).toBeNull();
    const payload = (
      result.updateData.data as {
        uiElements?: Array<{ payload?: Record<string, unknown> }>;
      }
    ).uiElements?.[0]?.payload;
    expect(payload?.['requiredServiceIds']).toEqual(plan.requiredServiceIds);
    expect(payload?.['primaryImplementations']).toEqual(plan.primaryImplementations);
  });

  it('falls through when the active handler does not declare the response type', () => {
    const summary = JSON.stringify({
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
    });
    const logger = makeLogger();

    const result = dispatchResponseType(
      summary,
      dispatchContext(null, ['final_assessment_v2']),
      logger,
    );

    expect(result).toEqual({
      matched: false,
      incompatibleResponseType: 'startup_plan_v1',
    });
    expect(logger.info).toHaveBeenCalledWith('response_dispatch.incompatible_pair', {
      promptType: 'test',
      responseType: 'startup_plan_v1',
    });
  });

  it('does not enter the legacy startup-plan branch for a handler with no structured response allowlist', () => {
    const summary = JSON.stringify({
      responseType: 'startup_plan_v1',
      sessionTitle: 'Implement auth',
      requiredServiceIds: ['service-auth'],
      primaryImplementations: [
        {
          title: 'Login endpoint',
          content: 'POST /login',
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
    });

    const result = dispatchResponseType(summary, dispatchContext(null, []), NOOP_LOGGER);

    expect(result).toEqual({
      matched: false,
      incompatibleResponseType: 'startup_plan_v1',
    });
  });

  it('presents an eligible startup plan as a report acknowledgement without the legacy UI element', () => {
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

    const result = dispatchResponseType(
      JSON.stringify(plan),
      dispatchContext(null, ['startup_plan_v1'], false),
      NOOP_LOGGER,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.updateData).toMatchObject({
      status: 'completed',
      data: {
        type: 'AGENT',
        title: 'Plan Generated',
        response: 'Your plan is ready.',
        processResponseType: 'startup_plan_v1',
      },
    });
    expect((result.updateData.data as { response?: string }).response).not.toContain('report');
    expect((result.updateData.data as { uiElements?: unknown[] }).uiElements).toBeUndefined();
  });

  it('surfaces nextAction=APPROVED on the pendingCompletion field of a startup_plan_v1 dispatch', () => {
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
    const result = dispatchResponseType(JSON.stringify(plan), dispatchContext(null), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.pendingCompletion).toEqual({ action: 'APPROVED' });
  });

  it('surfaces nextAction=REVISED on the pendingCompletion field of a startup_plan_v1 dispatch', () => {
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
    const result = dispatchResponseType(JSON.stringify(plan), dispatchContext(null), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.pendingCompletion).toEqual({ action: 'REVISED' });
  });

  it('rejects a startup_plan_v1 body with an empty executionPlan instead of dispatching it', () => {
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
      executionPlan: [],
      discrepancies: [],
      clarificationQuestions: [],
    };
    const logger = makeLogger();

    const result = dispatchResponseType(JSON.stringify(plan), dispatchContext(null), logger);

    expect(result.matched).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'response_dispatch.parse_failed',
      expect.objectContaining({ responseType: 'startup_plan_v1' }),
    );
  });

  it('leaves pendingCompletion null for non-startup response types', () => {
    const finalAssessment = {
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
    };
    const result = dispatchResponseType(
      JSON.stringify(finalAssessment),
      dispatchContext('task-1'),
      NOOP_LOGGER,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.pendingCompletion).toBeNull();
  });

  it('routes by the JSON responseType field, not prose mentions of other tokens', () => {
    // Regression: this real-world startup_plan_v1 payload contains
    // `final_assessment_v2` as a substring inside a step description.
    // The old detector scanned the whole string for known tokens and
    // matched the prose mention first, so dispatch attempted to parse
    // the payload against the wrong schema and returned matched:false.
    const summary = readFileSync(join(fixturesDir, 'startup-plan-with-prose-token.md'), 'utf8');

    const result = dispatchResponseType(summary, dispatchContext(null), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.responseType).toBe('startup_plan_v1');
  });

  it('strips the terminal JSON block from the analyze turn visible message and carries discrepancies to completion', () => {
    const discrepancies = [
      {
        summary: 'Auth feature missing SSO',
        rationale: 'the design doc adds SSO the tree does not name',
        entityType: 'FEATURE',
        entityId: 'feat-1',
        proposal: 'update the Auth feature to cover SSO',
      },
    ];
    const json = JSON.stringify({
      responseType: 'plan_shaping_feature_sync_analyze_v1',
      action: 'DISCREPANCY',
      discrepancies,
    });
    const prose =
      'I noticed a gap before we lay out the stages:\n\n' +
      '| Source Type | Source | Description |\n' +
      '| --- | --- | --- |\n' +
      '| feature | @[feature:feat-1|Auth] | missing SSO |';
    const summary = `${prose}\n\n\`\`\`json\n${json}\n\`\`\``;

    const result = dispatchResponseType(summary, dispatchContext(null), NOOP_LOGGER);

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.responseType).toBe('plan_shaping_feature_sync_analyze_v1');

    const response = (result.updateData.data as { response?: string }).response ?? '';
    expect(response).toContain('@[feature:feat-1|Auth]');
    expect(response).toContain('| missing SSO |');
    expect(response).not.toContain('responseType');
    expect(response).not.toContain('```');

    // The completion still carries the full discrepancies list.
    expect(result.pendingCompletion).toEqual({
      action: 'DISCREPANCY',
      payload: { discrepancies },
    });
  });

  it('falls through (matched=false) on schema failure and logs a warning', () => {
    const badJson = JSON.stringify({
      responseType: 'final_assessment_v2',
      taskAssessment: { verdict: 'completed' },
    });
    const summary = `responseType intro:\n\n${badJson}`;
    const logger = makeLogger();

    const result = dispatchResponseType(summary, dispatchContext(null), logger);

    expect(result.matched).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'response_dispatch.parse_failed',
      expect.objectContaining({ responseType: 'final_assessment_v2' }),
    );
  });
});
