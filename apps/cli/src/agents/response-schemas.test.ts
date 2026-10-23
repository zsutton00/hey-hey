import { describe, expect, it } from 'vitest';
import type { GoalPmRoutingSelectionPayload } from '../shared/api/index';
import {
  parseStartupSessionPlanResponse,
  parseFinalAssessmentResponse,
  parseGoalPmRoutingResponse,
  parseVerificationPlanResponse,
  parseChildTaskDescriptionUpdateResponse,
  parseDailySessionResponse,
  parsePlanShapingFeatureSyncIterateResponse,
  parseImplementationReadinessResponse,
} from './response-schemas';

const validImplementationReadinessResponse = {
  responseType: 'implementation_readiness_v1',
  disposition: {
    state: 'REVIEW_REQUIRED',
    sourceSnapshot: {
      runId: 'run-1',
      focalEntityId: 'task-1',
      focalEntityType: 'TASK',
      sourceRevision: 'sha256:source',
      capturedAt: '2026-09-17T19:00:00.000Z',
    },
    finding: {
      affectedSourceContext: 'Task context',
      unresolvedDecision: 'Which observable behavior should the boundary provide?',
      consequentialInventionRisk: 'Implementation would invent observable behavior.',
      boundedEvidence: [
        {
          category: 'behavior',
          statement: 'The checked context leaves two observable outcomes open.',
        },
      ],
      answerKind: 'Choose the observable behavior.',
    },
    resolution: { kind: 'NONE' },
  },
};

describe('parseImplementationReadinessResponse', () => {
  it('accepts the typed review result emitted by free_form', () => {
    const result = parseImplementationReadinessResponse(validImplementationReadinessResponse);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('implementation_readiness_v1');
      expect(result.value.disposition.state).toBe('REVIEW_REQUIRED');
    }
  });

  it('rejects a readiness result with an unbounded extra field', () => {
    const result = parseImplementationReadinessResponse({
      ...validImplementationReadinessResponse,
      unexpected: true,
    });

    expect(result.ok).toBe(false);
  });

  it('reserves DISMISSED for the confirmed user action', () => {
    const result = parseImplementationReadinessResponse({
      ...validImplementationReadinessResponse,
      disposition: {
        ...validImplementationReadinessResponse.disposition,
        state: 'DISMISSED',
        resolution: {
          kind: 'DISMISSED',
          runId: 'run-1',
          sourceRevision: 'sha256:source',
          resolvedAt: '2026-09-17T20:00:00.000Z',
        },
      },
    });
    expect(result).toMatchObject({ ok: false });
  });
});

const validGoalPmRoutingResponse = {
  responseType: 'goal_pm_routing_v1',
  goalId: '11111111-1111-4111-8111-111111111111',
  options: [
    {
      optionId: 'existing-conversation',
      kind: 'existingConversation',
      conversationId: '22222222-2222-4222-8222-222222222222',
      title: 'Existing goal thread',
      evidence: [
        {
          messageId: '33333333-3333-4333-8333-333333333333',
          excerpt: 'The thread discusses the same goal slice.',
          rationale: 'The message directly covers the requested scope.',
        },
      ],
      rationale: 'The thread discusses the same goal slice.',
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
      prompt: 'Which part of the goal should I prioritize?',
      rationale: 'A focused clarification could distinguish the matches.',
    },
    {
      optionId: 'track-existing-task',
      kind: 'trackExistingWork',
      target: {
        entityType: 'TASK',
        entityId: '44444444-4444-4444-8444-444444444444',
        title: 'Existing goal task',
      },
      rationale: 'This task already delivers the requested work.',
      requiresSelection: true,
    },
    {
      optionId: 'track-existing-plan',
      kind: 'trackExistingWork',
      target: {
        entityType: 'PLAN',
        entityId: '55555555-5555-4555-8555-555555555555',
        title: 'Existing goal plan',
      },
      rationale: 'This plan already covers the requested work.',
      requiresSelection: true,
    },
    {
      optionId: 'create-missing-work',
      kind: 'createMissingWork',
      parentFeatureId: '66666666-6666-4666-8666-666666666666',
      workItemType: 'TASK',
      title: 'Create goal work',
      description: 'Add the missing work under the correct feature.',
      acceptanceCriteria: 'The selected task is proposed before it is created.',
      authoringMode: 'PROPOSAL',
      rationale: 'No eligible existing work was found.',
      requiresSelection: true,
    },
    {
      optionId: 'proposal-review',
      kind: 'proposal',
      proposalId: '77777777-7777-4777-8777-777777777777',
      title: 'Review the goal proposal',
      rationale: 'A pending proposal is relevant to this request.',
      requiresSelection: true,
    },
  ],
};

describe('parseStartupSessionPlanResponse', () => {
  const valid = {
    responseType: 'startup_plan_v1',
    sessionTitle: 'Add user auth',
    requiredServiceIds: ['service-auth'],
    primaryImplementations: [
      {
        title: 'Authentication middleware',
        content: 'export const requireAuth = createAuthMiddleware();',
        language: 'TypeScript',
        location: 'src/auth/require-auth.ts',
        rationale: 'This middleware is the behavior-defining centerpiece.',
      },
    ],
    executionPlan: [
      {
        stepId: 'step-1',
        title: 'Create middleware',
        description: 'Add auth middleware to express app',
        phase: 1,
        references: [{ sourceType: 'task', sourceId: 'task-1', rationale: 'Main task' }],
      },
    ],
    discrepancies: [],
    clarificationQuestions: [],
  };

  it('accepts valid startup response', () => {
    const result = parseStartupSessionPlanResponse(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionTitle).toBe('Add user auth');
      expect(result.value.requiredServiceIds).toEqual(['service-auth']);
    }
  });

  it('rejects wrong responseType', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      responseType: 'wrong',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects empty sessionTitle', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      sessionTitle: '',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a startup response without required Service scope', () => {
    const { requiredServiceIds: _, ...withoutServiceScope } = valid;
    const result = parseStartupSessionPlanResponse(withoutServiceScope);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate required Service IDs', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      requiredServiceIds: ['service-auth', 'service-auth'],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects missing executionPlan', () => {
    const { executionPlan: _, ...noExecPlan } = valid;
    const result = parseStartupSessionPlanResponse(noExecPlan);
    expect(result.ok).toBe(false);
  });

  it('rejects a step with a missing phase', () => {
    const { phase: _, ...stepWithoutPhase } = valid.executionPlan[0]!;
    const result = parseStartupSessionPlanResponse({
      ...valid,
      executionPlan: [stepWithoutPhase],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a step with a non-positive phase', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      executionPlan: [{ ...valid.executionPlan[0]!, phase: 0 }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects the removed difficulty field', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      executionPlan: [{ ...valid.executionPlan[0]!, difficulty: 'easy' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects the former valid difficulty enum', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      executionPlan: [{ ...valid.executionPlan[0]!, difficulty: 'hard' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty primaryImplementations array', () => {
    const result = parseStartupSessionPlanResponse({ ...valid, primaryImplementations: [] });
    expect(result.ok).toBe(false);
  });

  it('accepts code, database, and prose primary implementations without connections', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      primaryImplementations: [
        valid.primaryImplementations[0],
        {
          title: 'Sessions table',
          content: 'CREATE TABLE sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL);',
          language: 'SQL',
          location: 'public.sessions',
          rationale: 'The table is the durable session boundary.',
        },
        {
          title: 'Authentication requirement',
          content: 'Every protected request must present a currently valid session.',
          language: 'Markdown',
          location: 'Requirements / Authentication',
          rationale: 'The requirement is the primary prose contract.',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primaryImplementations).toHaveLength(3);
      expect(result.value.primaryImplementations[0]?.connections).toBeUndefined();
    }
  });

  it('accepts evidence-gated workflow-step and Contract connections', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      primaryImplementations: [
        {
          ...valid.primaryImplementations[0],
          connections: [
            {
              entityType: 'workflowStep',
              entityId: '11111111-1111-4111-8111-111111111111',
              entityTitle: 'Validate session',
              relationship: 'fulfills',
              sourceField: 'graphEdge.FULFILLED_BY',
              sourceExcerpt: 'Validate the presented session before the request proceeds.',
              rationale: 'The middleware implements this exact workflow action.',
            },
            {
              entityType: 'contract',
              entityId: '22222222-2222-4222-8222-222222222222',
              entityTitle: 'Session validation contract',
              relationship: 'enforces',
              sourceField: 'sections.guarantee',
              sourceExcerpt: 'Protected routes reject expired or missing sessions.',
              rationale: 'The middleware enforces the stated cross-boundary guarantee.',
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects incomplete or semantically invalid connections', () => {
    const baseConnection = {
      entityType: 'workflowStep',
      entityId: '11111111-1111-4111-8111-111111111111',
      entityTitle: 'Validate session',
      relationship: 'fulfills',
      sourceField: 'sections.description',
      sourceExcerpt: 'Validate the presented session before the request proceeds.',
      rationale: 'The middleware implements this exact workflow action.',
    };
    expect(
      parseStartupSessionPlanResponse({
        ...valid,
        primaryImplementations: [
          {
            ...valid.primaryImplementations[0],
            connections: [{ ...baseConnection, sourceExcerpt: '' }],
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseStartupSessionPlanResponse({
        ...valid,
        primaryImplementations: [
          {
            ...valid.primaryImplementations[0],
            connections: [{ ...baseConnection, relationship: 'authors' }],
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseStartupSessionPlanResponse({
        ...valid,
        primaryImplementations: [
          {
            ...valid.primaryImplementations[0],
            connections: [{ ...baseConnection, entityId: 'not-a-uuid' }],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it('accepts discrepancies with all required fields', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      discrepancies: [
        {
          sourceRef: { sourceType: 'evidenceItem', sourceId: 'ev-1' },
          sourceExcerpt: 'The API returns XML.',
          reasoning: 'Codebase uses JSON. Will use JSON.',
          discrepancyText: 'API format mismatch.',
          severity: 'low',
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(parseStartupSessionPlanResponse(null).ok).toBe(false);
    expect(parseStartupSessionPlanResponse('string').ok).toBe(false);
    expect(parseStartupSessionPlanResponse(42).ok).toBe(false);
  });

  it('accepts a plan without missedSteps (free-task variant remains byte-identical)', () => {
    const result = parseStartupSessionPlanResponse(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missedSteps).toBeUndefined();
    }
  });

  it('accepts a plan with an empty missedSteps array', () => {
    const result = parseStartupSessionPlanResponse({ ...valid, missedSteps: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missedSteps).toEqual([]);
    }
  });

  it('accepts a plan with a populated missedSteps array', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      missedSteps: [
        {
          title: 'Missing OpenAPI regen step',
          description:
            'The execution plan reads the new field on the generated client, but no upstream step regenerates the client.',
          missingPrecondition: 'regenerated agent-bridge client',
          suggestedResolution: {
            type: 'insert_step',
            description:
              'Add a new step on the codegen stage that runs pnpm generate:agent-bridge before the consumer steps.',
            targetStageId: 'stage-codegen',
            proposalId: 'prop-1',
          },
          references: [{ sourceType: 'plan', sourceId: 'plan-abc', rationale: 'upstream plan' }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missedSteps).toHaveLength(1);
      expect(result.value.missedSteps?.[0]?.suggestedResolution.type).toBe('insert_step');
    }
  });

  it('rejects a missedStep with an unknown suggestedResolution.type', () => {
    const result = parseStartupSessionPlanResponse({
      ...valid,
      missedSteps: [
        {
          title: 'X',
          description: 'Y',
          suggestedResolution: { type: 'rewrite_plan', description: 'nope' },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe('parseFinalAssessmentResponse', () => {
  const validHierarchyWalk = [
    {
      entityType: 'task',
      entityId: 'task-1',
      name: 'Implement auth',
      distance: 0,
      action: 'proposed_update',
      rationale: 'Task was directly worked on.',
    },
    {
      entityType: 'feature',
      entityId: 'feat-1',
      name: 'Auth Feature',
      distance: 1,
      section: 'description',
      action: 'no_update',
      rationale: 'Description already covers the implemented flow.',
    },
    {
      entityType: 'feature',
      entityId: 'feat-1',
      name: 'Auth Feature',
      distance: 1,
      section: 'requirements',
      action: 'proposed_update',
      rationale:
        'Enrichment: session establishes that every login emits an audit event — adding as a new requirements bullet.',
    },
  ];

  const valid = {
    responseType: 'final_assessment_v2',
    taskAssessment: {
      target: { entityType: 'task', entityId: 'task-1' },
      verdict: 'completed',
      statusRecommendation: {
        status: 'COMPLETED',
        reason: 'All done.',
      },
      summary: 'Successfully implemented.',
    },
    hierarchyWalk: validHierarchyWalk,
  };

  it('accepts valid final assessment', () => {
    const result = parseFinalAssessmentResponse(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskAssessment.verdict).toBe('completed');
      expect(result.value.hierarchyWalk).toHaveLength(3);
    }
  });

  it('accepts feature entries with section="description" and section="requirements"', () => {
    const result = parseFinalAssessmentResponse(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sections = result.value
        .hierarchyWalk!.filter((e) => e.entityType === 'feature')
        .map((e) => (e as { section?: string }).section);
      expect(sections).toEqual(['description', 'requirements']);
    }
  });

  it('accepts a hierarchyWalk with a single distance-0 task entry (no section)', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      hierarchyWalk: [
        {
          entityType: 'task',
          entityId: 'task-1',
          name: 'Implement auth',
          distance: 0,
          action: 'no_update',
          rationale: 'Task-level record only.',
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects hierarchyWalk entry with an unknown section value', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      hierarchyWalk: [
        {
          entityType: 'feature',
          entityId: 'feat-1',
          name: 'Auth Feature',
          distance: 1,
          section: 'acceptanceCriteria',
          action: 'no_update',
          rationale: 'Irrelevant section.',
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid verdict', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      taskAssessment: {
        ...valid.taskAssessment,
        verdict: 'invalid_verdict',
      },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects missing taskAssessment', () => {
    const { taskAssessment: _, ...noAssessment } = valid;
    const result = parseFinalAssessmentResponse(noAssessment);
    expect(result.ok).toBe(false);
  });

  it('rejects wrong responseType', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      responseType: 'wrong',
    });
    expect(result.ok).toBe(false);
  });

  it('ignores extra fields', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      extraField: 'should be ignored',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects missing hierarchyWalk', () => {
    const { hierarchyWalk: _, ...noWalk } = valid;
    const result = parseFinalAssessmentResponse(noWalk);
    expect(result.ok).toBe(false);
  });

  it('rejects empty hierarchyWalk array', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      hierarchyWalk: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects hierarchyWalk entry with missing rationale', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      hierarchyWalk: [
        {
          entityType: 'task',
          entityId: 'task-1',
          name: 'Implement auth',
          distance: 0,
          action: 'proposed_update',
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects hierarchyWalk entry with invalid action', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      hierarchyWalk: [
        {
          entityType: 'task',
          entityId: 'task-1',
          name: 'Implement auth',
          distance: 0,
          action: 'invalid_action',
          rationale: 'Some reason.',
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts valid dependentTaskWalk', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      dependentTaskWalk: [
        {
          entityType: 'task',
          entityId: 'task-2',
          name: 'Downstream task',
          relationshipType: 'DEPENDS_ON',
          action: 'proposed_update',
          rationale: 'Field name changed from userId to accountId.',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const walk = (result.value as unknown as Record<string, unknown>)[
        'dependentTaskWalk'
      ] as Array<Record<string, unknown>>;
      expect(walk).toHaveLength(1);
      expect(walk[0]!['relationshipType']).toBe('DEPENDS_ON');
    }
  });

  it('accepts final assessment without dependentTaskWalk', () => {
    const result = parseFinalAssessmentResponse(valid);
    expect(result.ok).toBe(true);
  });

  it('rejects dependentTaskWalk entry with missing relationshipType', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      dependentTaskWalk: [
        {
          entityType: 'task',
          entityId: 'task-2',
          name: 'Downstream task',
          action: 'no_update',
          rationale: 'No stale specifics found.',
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects dependentTaskWalk entry with invalid action', () => {
    const result = parseFinalAssessmentResponse({
      ...valid,
      dependentTaskWalk: [
        {
          entityType: 'task',
          entityId: 'task-2',
          name: 'Downstream task',
          relationshipType: 'RELATED_TO',
          action: 'skip',
          rationale: 'Some reason.',
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe('parseVerificationPlanResponse', () => {
  const valid = {
    responseType: 'verification_plan_v1',
    verificationChecks: [
      {
        checkId: 'check-1',
        tier: 'product_walkthrough',
        priority: 1,
        goal: 'Verify login',
        target: { entityType: 'task', entityId: 'task-1' },
        steps: ['Open app', 'Login'],
        expectedResult: 'Dashboard shown',
        fallback: null,
        evidenceRefs: [{ sourceType: 'task', sourceId: 'task-1' }],
      },
    ],
    coverageSummary: {
      verifiedBehaviors: ['Login'],
      remainingRisks: ['Token expiry'],
      recommendedNextAction: 'Test edge cases',
    },
  };

  it('accepts valid verification plan', () => {
    const result = parseVerificationPlanResponse(valid);
    expect(result.ok).toBe(true);
  });

  it('rejects empty steps array', () => {
    const result = parseVerificationPlanResponse({
      ...valid,
      verificationChecks: [{ ...valid.verificationChecks[0], steps: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts fallback with valid structure', () => {
    const result = parseVerificationPlanResponse({
      ...valid,
      verificationChecks: [
        {
          ...valid.verificationChecks[0],
          fallback: {
            tier: 'automated_test',
            trigger: 'When no browser available',
            steps: ['Run test suite'],
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe('parseChildTaskDescriptionUpdateResponse', () => {
  it('accepts valid child task update', () => {
    const result = parseChildTaskDescriptionUpdateResponse({
      responseType: 'child_task_description_update_v1',
      updates: [{ taskId: 'child-1', integrationNote: 'Parent built the API.' }],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts empty updates array', () => {
    const result = parseChildTaskDescriptionUpdateResponse({
      responseType: 'child_task_description_update_v1',
      updates: [],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects wrong responseType', () => {
    const result = parseChildTaskDescriptionUpdateResponse({
      responseType: 'wrong',
      updates: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe('parseDailySessionResponse', () => {
  const valid = {
    responseType: 'daily_session_v1',
    response: 'Here is your daily briefing.',
    reports: [
      {
        reportType: 'GOAL_PROGRESS',
        text: 'Auth refactor is on track with two tasks remaining.',
        entities: [
          { entityType: 'FEATURE', entityId: 'feat-1', relation: 'PRIMARY' },
          { entityType: 'TASK', entityId: 'task-1', relation: 'CONTEXT' },
        ],
      },
      {
        reportType: 'RISK_ALERT',
        text: 'The API migration has a blocked task with no owner.',
      },
    ],
  };

  it('accepts valid response with reports', () => {
    const result = parseDailySessionResponse(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.response).toBe('Here is your daily briefing.');
      expect(result.value.reports).toHaveLength(2);
      expect(result.value.reports[0]!.reportType).toBe('GOAL_PROGRESS');
      expect(result.value.reports[0]!.text).toContain('Auth refactor');
      expect(result.value.reports[0]!.entities).toHaveLength(2);
      expect(result.value.reports[0]!.entities![0]!.relation).toBe('PRIMARY');
      expect(result.value.reports[1]!.entities).toEqual([]);
    }
  });

  it('rejects response with no reports', () => {
    const result = parseDailySessionResponse({ ...valid, reports: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects wrong responseType', () => {
    const result = parseDailySessionResponse({ ...valid, responseType: 'wrong' });
    expect(result.ok).toBe(false);
  });

  it('rejects empty response string', () => {
    const result = parseDailySessionResponse({ ...valid, response: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects report with empty text', () => {
    const result = parseDailySessionResponse({
      ...valid,
      reports: [{ reportType: 'GOAL_PROGRESS', text: '' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects report with invalid type', () => {
    const result = parseDailySessionResponse({
      ...valid,
      reports: [{ reportType: 'INVALID_TYPE', text: 'Some text.' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects entity with invalid relation', () => {
    const result = parseDailySessionResponse({
      ...valid,
      reports: [
        {
          reportType: 'GOAL_PROGRESS',
          text: 'Some text.',
          entities: [{ entityType: 'TASK', entityId: 'task-1', relation: 'INVALID' }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects missing response field', () => {
    const { response: _, ...noResponse } = valid;
    const result = parseDailySessionResponse(noResponse);
    expect(result.ok).toBe(false);
  });
});

describe('parsePlanShapingFeatureSyncIterateResponse', () => {
  const validIterateResponse = {
    responseType: 'plan_shaping_feature_sync_iterate_v1' as const,
    discrepancies: [
      {
        summary: 'Missing feature description',
        rationale: 'The feature needs a complete description',
        entityType: 'FEATURE' as const,
        entityId: 'feature-1',
      },
    ],
    proposals: [
      {
        type: 'SINGLE' as const,
        action: 'UPDATE' as const,
        targetEntityId: 'task-1',
        targetEntityType: 'TASK' as const,
        eli5: 'This proposal fills in the missing task detail.',
        updates: {
          name: 'Updated task name',
          description: 'Complete task description',
        },
      },
    ],
  };

  it('accepts valid plan-shaping feature-sync iterate response', () => {
    const result = parsePlanShapingFeatureSyncIterateResponse(validIterateResponse);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('plan_shaping_feature_sync_iterate_v1');
      expect(result.value.discrepancies).toHaveLength(1);
      expect(result.value.discrepancies[0]!.summary).toBe('Missing feature description');
      expect(result.value.proposals).toHaveLength(1);
      expect(result.value.proposals[0]!.action).toBe('UPDATE');
    }
  });

  it('rejects wrong responseType', () => {
    const result = parsePlanShapingFeatureSyncIterateResponse({
      ...validIterateResponse,
      responseType: 'plan_shaping_feature_sync_analyze_v1',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects missing discrepancies array', () => {
    const { discrepancies: _, ...noDiscrepancies } = validIterateResponse;
    const result = parsePlanShapingFeatureSyncIterateResponse(noDiscrepancies);
    expect(result.ok).toBe(false);
  });

  it('rejects missing proposals array', () => {
    const { proposals: _, ...noProposals } = validIterateResponse;
    const result = parsePlanShapingFeatureSyncIterateResponse(noProposals);
    expect(result.ok).toBe(false);
  });

  it('rejects empty proposals array', () => {
    const result = parsePlanShapingFeatureSyncIterateResponse({
      ...validIterateResponse,
      proposals: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects empty discrepancies array', () => {
    const result = parsePlanShapingFeatureSyncIterateResponse({
      ...validIterateResponse,
      discrepancies: [],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts multiple discrepancies and proposals', () => {
    const multiItemResponse = {
      ...validIterateResponse,
      discrepancies: [
        ...validIterateResponse.discrepancies,
        {
          summary: 'Another issue',
          rationale: 'Additional rationale',
          entityType: 'TASK' as const,
          entityId: 'task-1',
        },
      ],
      proposals: [
        ...validIterateResponse.proposals,
        {
          type: 'SINGLE' as const,
          action: 'CREATE' as const,
          targetEntityId: 'task-2',
          targetEntityType: 'TASK' as const,
          eli5: 'This proposal adds the missing task.',
          updates: {
            name: 'New task',
            description: 'Task description',
          },
        },
      ],
    };
    const result = parsePlanShapingFeatureSyncIterateResponse(multiItemResponse);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.discrepancies).toHaveLength(2);
      expect(result.value.proposals).toHaveLength(2);
    }
  });
});

describe('parseGoalPmRoutingResponse', () => {
  it('keeps the downstream selection payload singular and record-only', () => {
    const selection = {
      sourceMessageId: '88888888-8888-4888-8888-888888888888',
      uiElementId: 'goal-pm-action-field',
      selectedOptionId: 'existing-conversation',
    } satisfies GoalPmRoutingSelectionPayload;

    expect(Object.keys(selection)).toEqual(['sourceMessageId', 'uiElementId', 'selectedOptionId']);
  });

  it('accepts every routing option kind with canonical evidence and identities', () => {
    const result = parseGoalPmRoutingResponse(validGoalPmRoutingResponse);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.goalId).toBe(validGoalPmRoutingResponse.goalId);
      expect(result.value.options).toHaveLength(7);
      expect(result.value.options[0]?.kind).toBe('existingConversation');
      expect(
        result.value.options[0]?.kind === 'existingConversation' &&
          result.value.options[0].evidence,
      ).toHaveLength(1);
      expect(result.value.options[4]?.kind).toBe('trackExistingWork');
      expect(
        result.value.options[4]?.kind === 'trackExistingWork' &&
          result.value.options[4].target.entityType,
      ).toBe('PLAN');
    }
  });

  it('rejects a duplicate offered option id', () => {
    const duplicate = {
      ...validGoalPmRoutingResponse,
      options: [validGoalPmRoutingResponse.options[0], validGoalPmRoutingResponse.options[0]],
    };
    expect(parseGoalPmRoutingResponse(duplicate).ok).toBe(false);
  });

  it('requires one start-new option and permits refine-search to follow inventory validation', () => {
    expect(
      parseGoalPmRoutingResponse({
        ...validGoalPmRoutingResponse,
        options: validGoalPmRoutingResponse.options.filter(
          (option) => option.kind !== 'startNewConversation',
        ),
      }).ok,
    ).toBe(false);

    const startNewOnly = validGoalPmRoutingResponse.options.filter(
      (option) => option.kind === 'startNewConversation',
    );
    expect(
      parseGoalPmRoutingResponse({
        ...validGoalPmRoutingResponse,
        options: startNewOnly,
      }).ok,
    ).toBe(true);

    for (const duplicateKind of ['startNewConversation', 'refineSearch']) {
      const duplicate = validGoalPmRoutingResponse.options.find(
        (option) => option.kind === duplicateKind,
      );
      expect(duplicate).toBeDefined();
      expect(
        parseGoalPmRoutingResponse({
          ...validGoalPmRoutingResponse,
          options: [
            ...validGoalPmRoutingResponse.options,
            { ...duplicate, optionId: `duplicate-${duplicateKind}` },
          ],
        }).ok,
      ).toBe(false);
    }
  });

  it('rejects flattened existing-work targets', () => {
    const response = {
      ...validGoalPmRoutingResponse,
      options: [
        ...validGoalPmRoutingResponse.options.filter(
          (option) => option.kind !== 'trackExistingWork',
        ),
        {
          optionId: 'flattened-existing-task',
          kind: 'trackExistingWork',
          entityType: 'TASK',
          entityId: '44444444-4444-4444-8444-444444444444',
          title: 'Existing goal task',
          rationale: 'This task already delivers the requested work.',
          requiresSelection: true,
        },
      ],
    };

    expect(parseGoalPmRoutingResponse(response).ok).toBe(false);
  });

  it('rejects a placeholder conversation title', () => {
    for (const title of ['Conversation', '<canonical conversation title>']) {
      expect(
        parseGoalPmRoutingResponse({
          ...validGoalPmRoutingResponse,
          options: [
            {
              ...validGoalPmRoutingResponse.options[0],
              title,
            },
          ],
        }).ok,
      ).toBe(false);
    }
  });

  it('rejects a malformed conversation identity or missing message evidence', () => {
    expect(
      parseGoalPmRoutingResponse({
        ...validGoalPmRoutingResponse,
        options: [
          {
            ...validGoalPmRoutingResponse.options[0],
            conversationId: 'not-a-conversation-id',
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseGoalPmRoutingResponse({
        ...validGoalPmRoutingResponse,
        options: [
          {
            ...validGoalPmRoutingResponse.options[0],
            evidence: [],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it('rejects the predecessor action-shaped response and mutation-like fields', () => {
    expect(
      parseGoalPmRoutingResponse({
        responseType: 'goal_pm_action_v1',
        goalId: validGoalPmRoutingResponse.goalId,
        action: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGoalPmRoutingResponse({
        ...validGoalPmRoutingResponse,
        options: [
          {
            ...validGoalPmRoutingResponse.options[0],
            mutation: 'attach_to_goal',
          },
        ],
      }).ok,
    ).toBe(false);
  });
});
