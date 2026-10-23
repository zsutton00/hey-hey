import { describe, expect, it } from 'vitest';
import {
  extractStructuredJsonPayload,
  parseChildTaskDescriptionUpdateResponseFromText,
  parseFinalAssessmentResponseFromText,
  parseGoalPmRoutingResponseFromText,
  parseNeighborhoodTaskUpdatesResponseFromText,
  parsePlanShapingFeatureSyncIterateResponseFromText,
  parseSetSplittingResponseFromText,
  parseStartupSessionPlanResponseFromText,
  parseVerificationPlanResponseFromText,
  stripStructuredJsonBlock,
} from './response-parser';

const validGoalPmRoutingEvidence = {
  messageId: '33333333-3333-4333-8333-333333333333',
  excerpt: 'The thread discusses the same goal slice.',
  rationale: 'The message directly covers the requested scope.',
};

const validGoalPmRoutingResponse = {
  responseType: 'goal_pm_routing_v1',
  goalId: '11111111-1111-4111-8111-111111111111',
  options: [
    {
      optionId: 'existing-conversation',
      kind: 'existingConversation',
      conversationId: '22222222-2222-4222-8222-222222222222',
      title: 'Existing goal thread',
      evidence: [validGoalPmRoutingEvidence],
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
      optionId: 'create-missing-work',
      kind: 'createMissingWork',
      parentFeatureId: '44444444-4444-4444-8444-444444444444',
      workItemType: 'TASK',
      title: 'Create goal work',
      description: 'Add missing work under the correct feature.',
      acceptanceCriteria: 'The selected task is proposed before it is created.',
      authoringMode: 'PROPOSAL',
      rationale: 'No eligible existing work was found.',
      requiresSelection: true,
    },
    {
      optionId: 'proposal-review',
      kind: 'proposal',
      proposalId: '55555555-5555-4555-8555-555555555555',
      title: 'Review the goal proposal',
      rationale: 'A pending proposal is relevant to this request.',
      requiresSelection: true,
    },
  ],
};

describe('extractStructuredJsonPayload', () => {
  it('extracts JSON from fenced code block', () => {
    const text = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
    expect(extractStructuredJsonPayload(text)).toBe('{"key": "value"}');
  });

  it('extracts JSON from untyped fence', () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractStructuredJsonPayload(text)).toBe('{"a": 1}');
  });

  it('extracts JSON from bare braces when no fence', () => {
    const text = 'Some preamble {"responseType": "test"} trailing';
    expect(extractStructuredJsonPayload(text)).toBe('{"responseType": "test"}');
  });

  it('prefers fence over bare braces', () => {
    const text = '{"outer": true}\n```json\n{"inner": true}\n```';
    expect(extractStructuredJsonPayload(text)).toBe('{"inner": true}');
  });

  it('returns null for text with no JSON', () => {
    expect(extractStructuredJsonPayload('no json here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractStructuredJsonPayload('')).toBeNull();
  });

  it('handles nested braces', () => {
    const text = '{"a": {"b": 1}}';
    expect(extractStructuredJsonPayload(text)).toBe('{"a": {"b": 1}}');
  });

  it('prefers fence containing responseType over earlier non-JSON fences', () => {
    const text =
      'Explanation:\n```yaml\nfield: value\n```\n\n```json\n{"responseType": "test"}\n```';
    expect(extractStructuredJsonPayload(text)).toBe('{"responseType": "test"}');
  });

  it('extracts JSON when preamble contains curly braces', () => {
    const text =
      'LocalPromptDesignDocInput exists with { id?, title?, sections?: { [key: string]: string } }\n{"responseType": "test"}';
    expect(extractStructuredJsonPayload(text)).toBe('{"responseType": "test"}');
  });

  it('extracts a pretty-printed response after preamble object syntax', () => {
    const response = {
      responseType: 'goal_pm_routing_v1',
      goalId: '11111111-1111-4111-8111-111111111111',
      options: [
        {
          optionId: 'existing-conversation',
          kind: 'existingConversation',
          conversationId: '33333333-3333-4333-8333-333333333333',
          title: 'Goal discussion',
          evidence: [
            {
              messageId: '44444444-4444-4444-8444-444444444444',
              excerpt: 'The existing conversation matches the request.',
              rationale: 'The message is directly relevant.',
            },
          ],
          rationale: 'The existing conversation matches the request.',
        },
      ],
    };
    const text =
      'The matching record has shape { entityType: CONVERSATION, entityId: UUID }.\n' +
      JSON.stringify(response, null, 2) +
      '\nThe selection remains user-controlled.';

    expect(extractStructuredJsonPayload(text)).toBe(JSON.stringify(response, null, 2));
  });

  it('stops at the response envelope before object-like postscript text', () => {
    const response = JSON.stringify({ responseType: 'test', nested: { value: true } });
    const text = `${response}\nThe prose mentions another shape { entityId: UUID }.`;

    expect(extractStructuredJsonPayload(text)).toBe(response);
  });

  it('falls back to brace extraction when inner fences truncate the fence match', () => {
    const payload = {
      key: 'Some text\n\n```yaml\nfield: value\n```\n\nMore text',
    };
    const text = '```json\n' + JSON.stringify(payload) + '\n```';
    // The non-greedy fence regex matches to the first inner ```, returning
    // truncated content. extractStructuredJsonPayload returns that truncated
    // string, but parseTextAsJson handles the fallback to brace extraction.
    const result = extractStructuredJsonPayload(text);
    expect(result).not.toBe(JSON.stringify(payload));
    expect(result).toBeTruthy();
  });
});

describe('stripStructuredJsonBlock', () => {
  it('removes the fenced block carrying responseType, keeping the surrounding prose', () => {
    const text =
      'Here are a couple of gaps:\n\n| Source | Description |\n| --- | --- |\n| @[feature:f-1|Auth] | missing SSO |\n\n```json\n{"responseType": "plan_shaping_feature_sync_analyze_v1", "action": "DISCREPANCY"}\n```';
    const stripped = stripStructuredJsonBlock(text);
    expect(stripped).toContain('Here are a couple of gaps:');
    expect(stripped).toContain('| @[feature:f-1|Auth] | missing SSO |');
    expect(stripped).not.toContain('responseType');
    expect(stripped).not.toContain('```');
  });

  it('prefers the responseType fence over an earlier unrelated fence', () => {
    const text =
      'Example:\n```yaml\nfield: value\n```\n\nFindings below.\n\n```json\n{"responseType": "test"}\n```';
    const stripped = stripStructuredJsonBlock(text);
    expect(stripped).toContain('```yaml');
    expect(stripped).toContain('Findings below.');
    expect(stripped).not.toContain('responseType');
  });

  it('falls back to the first fence when none names responseType', () => {
    const text = 'Prose.\n```json\n{"key": "value"}\n```';
    expect(stripStructuredJsonBlock(text)).toBe('Prose.');
  });

  it('returns trimmed text unchanged when there is no fence', () => {
    expect(stripStructuredJsonBlock('  just prose  ')).toBe('just prose');
  });
});

const validStartupResponse = {
  responseType: 'startup_plan_v1',
  sessionTitle: 'Implement auth middleware',
  requiredServiceIds: ['service-auth'],
  primaryImplementations: [
    {
      title: 'Authentication middleware',
      content: 'export const requireAuth = createAuthMiddleware();',
      language: 'TypeScript',
      location: 'src/auth/require-auth.ts',
      rationale: 'This middleware defines the protected-request behavior.',
    },
  ],
  executionPlan: [
    {
      stepId: 'step-1',
      title: 'Add middleware',
      description: 'Create auth middleware',
      phase: 1,
      references: [
        {
          sourceType: 'task',
          sourceId: 'task-1',
          rationale: 'Primary task',
        },
      ],
    },
  ],
  discrepancies: [],
  clarificationQuestions: [],
};

describe('parseStartupSessionPlanResponseFromText', () => {
  it('parses valid startup response from fenced JSON', () => {
    const text = `\`\`\`json\n${JSON.stringify(validStartupResponse)}\n\`\`\``;
    const result = parseStartupSessionPlanResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('startup_plan_v1');
      expect(result.value.sessionTitle).toBe('Implement auth middleware');
      expect(result.value.executionPlan).toHaveLength(1);
    }
  });

  it('returns error for text without JSON', () => {
    const result = parseStartupSessionPlanResponseFromText('no json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No JSON object found');
    }
  });

  it('returns error for invalid JSON', () => {
    const result = parseStartupSessionPlanResponseFromText('{bad json}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid JSON payload');
    }
  });

  it('returns error for valid JSON that fails schema', () => {
    const result = parseStartupSessionPlanResponseFromText(
      JSON.stringify({ responseType: 'wrong' }),
    );
    expect(result.ok).toBe(false);
  });

  it('parses startup response when preamble contains curly braces', () => {
    const preamble = [
      'I now have all the information I need. Key findings:',
      '',
      'TaskRefinerChat is the template to follow',
      'LocalPromptDesignDocInput exists in generated API with { id?, title?, sections?: { [key: string]: string } }',
      'LocalDesignDocRefinerPromptPayload does NOT exist in the generated agent bridge types',
      'AgentSessionType.DesignDocRefining exists in the platform API',
      'LocalPromptType does NOT include design_doc_refiner yet',
      'DesignDocResponseDto has sections?: Array<MaterializedDesignDocSection> with key and materializedMarkdown',
      'useAgentSessions already supports designDocId filter',
    ].join('\n');
    const text = preamble + '\n' + JSON.stringify(validStartupResponse);
    const result = parseStartupSessionPlanResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('startup_plan_v1');
    }
  });
});

describe('parseGoalPmRoutingResponseFromText', () => {
  it('parses a typed Goal PM routing response from a fenced response', () => {
    const result = parseGoalPmRoutingResponseFromText(
      `The routing choices are ready.\n\n\`\`\`json\n${JSON.stringify(validGoalPmRoutingResponse)}\n\`\`\``,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('goal_pm_routing_v1');
      expect(result.value.goalId).toBe(validGoalPmRoutingResponse.goalId);
      expect(result.value.options.map((option) => option.kind)).toEqual([
        'existingConversation',
        'startNewConversation',
        'refineSearch',
        'createMissingWork',
        'proposal',
      ]);
    }
  });

  it('accepts the start-new-only empty-corpus response', () => {
    const result = parseGoalPmRoutingResponseFromText(
      JSON.stringify({
        responseType: 'goal_pm_routing_v1',
        goalId: validGoalPmRoutingResponse.goalId,
        options: [validGoalPmRoutingResponse.options[1]],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.options.map((option) => option.kind)).toEqual(['startNewConversation']);
    }
  });

  it('rejects the legacy action shape, duplicate options, and malformed evidence', () => {
    expect(
      parseGoalPmRoutingResponseFromText(
        JSON.stringify({
          responseType: 'goal_pm_action_v1',
          goalId: validGoalPmRoutingResponse.goalId,
          action: {},
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGoalPmRoutingResponseFromText(
        JSON.stringify({
          ...validGoalPmRoutingResponse,
          options: [validGoalPmRoutingResponse.options[0], validGoalPmRoutingResponse.options[0]],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGoalPmRoutingResponseFromText(
        JSON.stringify({
          ...validGoalPmRoutingResponse,
          options: [
            {
              ...validGoalPmRoutingResponse.options[0],
              title: 'Conversation',
              evidence: [
                {
                  ...validGoalPmRoutingEvidence,
                  messageId: 'not-a-message-id',
                },
              ],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it('rejects substantive answers and hidden mutation requests outside the routing contract', () => {
    for (const forbidden of [
      { answer: 'Here is how to complete the underlying goal work.' },
      { mutation: { type: 'createConversation' } },
      { selectedOptionId: 'existing-conversation' },
    ]) {
      expect(
        parseGoalPmRoutingResponseFromText(
          JSON.stringify({ ...validGoalPmRoutingResponse, ...forbidden }),
        ).ok,
      ).toBe(false);
    }
  });
});

const validFinalAssessmentResponse = {
  responseType: 'final_assessment_v2',
  taskAssessment: {
    target: { entityType: 'task', entityId: 'task-1' },
    verdict: 'completed',
    statusRecommendation: {
      status: 'COMPLETED',
      reason: 'All criteria met',
    },
    summary: 'Task completed successfully.',
  },
  hierarchyWalk: [
    {
      entityType: 'task',
      entityId: 'task-1',
      name: 'Test task',
      distance: 0,
      action: 'proposed_update',
      rationale: 'Task was directly worked on.',
    },
  ],
};

describe('parseFinalAssessmentResponseFromText', () => {
  it('parses valid final assessment response', () => {
    const text = JSON.stringify(validFinalAssessmentResponse);
    const result = parseFinalAssessmentResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskAssessment.verdict).toBe('completed');
    }
  });

  it('returns error for invalid JSON', () => {
    const result = parseFinalAssessmentResponseFromText('not json');
    expect(result.ok).toBe(false);
  });

  it('returns error for wrong responseType', () => {
    const result = parseFinalAssessmentResponseFromText(
      JSON.stringify({ ...validFinalAssessmentResponse, responseType: 'wrong' }),
    );
    expect(result.ok).toBe(false);
  });

  it('extracts JSON from the correct fence when earlier non-JSON fences exist', () => {
    const text = [
      '## Assessment',
      '',
      'All criteria satisfied.',
      '',
      '```yaml',
      'field: value',
      '```',
      '',
      'Some more explanation.',
      '',
      '```json',
      JSON.stringify(validFinalAssessmentResponse),
      '```',
    ].join('\n');
    const result = parseFinalAssessmentResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskAssessment.verdict).toBe('completed');
    }
  });

  it('parses final assessment with dependentTaskWalk', () => {
    const withDependentWalk = {
      ...validFinalAssessmentResponse,
      dependentTaskWalk: [
        {
          entityType: 'task',
          entityId: 'task-dep-1',
          name: 'Dependent task',
          relationshipType: 'DEPENDS_ON',
          action: 'no_update',
          rationale: 'No stale specifics found.',
        },
      ],
    };
    const text = JSON.stringify(withDependentWalk);
    const result = parseFinalAssessmentResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const walk = (result.value as unknown as Record<string, unknown>)[
        'dependentTaskWalk'
      ] as Array<Record<string, unknown>>;
      expect(walk).toHaveLength(1);
      expect(walk[0]!['relationshipType']).toBe('DEPENDS_ON');
    }
  });
});

const validVerificationPlanResponse = {
  responseType: 'verification_plan_v1',
  verificationChecks: [
    {
      checkId: 'check-1',
      tier: 'product_walkthrough',
      priority: 1,
      goal: 'Verify login works',
      target: { entityType: 'task', entityId: 'task-1' },
      steps: ['Open login page', 'Enter credentials'],
      expectedResult: 'Redirected to dashboard',
      fallback: null,
      evidenceRefs: [{ sourceType: 'task', sourceId: 'task-1' }],
    },
  ],
  coverageSummary: {
    verifiedBehaviors: ['Login flow'],
    remainingRisks: ['Edge case auth'],
    recommendedNextAction: 'Test with expired tokens',
  },
};

describe('parseVerificationPlanResponseFromText', () => {
  it('parses valid verification plan response', () => {
    const text = JSON.stringify(validVerificationPlanResponse);
    const result = parseVerificationPlanResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verificationChecks).toHaveLength(1);
      expect(result.value.coverageSummary.recommendedNextAction).toBe('Test with expired tokens');
    }
  });
});

const validChildTaskUpdateResponse = {
  responseType: 'child_task_description_update_v1',
  updates: [
    {
      taskId: 'child-1',
      integrationNote: 'Parent session established the auth contracts.',
    },
  ],
};

describe('parseChildTaskDescriptionUpdateResponseFromText', () => {
  it('parses valid child task update response', () => {
    const text = JSON.stringify(validChildTaskUpdateResponse);
    const result = parseChildTaskDescriptionUpdateResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updates).toHaveLength(1);
      expect(result.value.updates[0]!.taskId).toBe('child-1');
    }
  });

  it('rejects response with empty taskId', () => {
    const response = {
      responseType: 'child_task_description_update_v1',
      updates: [{ taskId: '', integrationNote: 'Some note.' }],
    };
    const result = parseChildTaskDescriptionUpdateResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });
});

const validNeighborhoodTaskUpdatesResponse = {
  responseType: 'neighborhood_task_updates_v1',
  taskUpdates: [
    {
      taskId: 'child-1',
      descriptionUpdate: 'Updated description with new context.',
      acceptanceCriteriaUpdate: null,
      reasoning: 'Parent session established auth contracts that this task should reference.',
    },
    {
      taskId: 'parent-1',
      descriptionUpdate: null,
      acceptanceCriteriaUpdate: 'Updated AC reflecting completed work.',
      reasoning: 'Acceptance criteria now partially satisfied by child session.',
    },
  ],
};

describe('parseNeighborhoodTaskUpdatesResponseFromText', () => {
  it('parses valid neighborhood task updates response', () => {
    const text = JSON.stringify(validNeighborhoodTaskUpdatesResponse);
    const result = parseNeighborhoodTaskUpdatesResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskUpdates).toHaveLength(2);
      expect(result.value.taskUpdates[0]!.taskId).toBe('child-1');
      expect(result.value.taskUpdates[0]!.descriptionUpdate).toBe(
        'Updated description with new context.',
      );
      expect(result.value.taskUpdates[0]!.acceptanceCriteriaUpdate).toBeNull();
      expect(result.value.taskUpdates[1]!.taskId).toBe('parent-1');
      expect(result.value.taskUpdates[1]!.descriptionUpdate).toBeNull();
      expect(result.value.taskUpdates[1]!.acceptanceCriteriaUpdate).toBe(
        'Updated AC reflecting completed work.',
      );
    }
  });

  it('parses response with empty taskUpdates array', () => {
    const response = {
      responseType: 'neighborhood_task_updates_v1',
      taskUpdates: [],
    };
    const result = parseNeighborhoodTaskUpdatesResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskUpdates).toHaveLength(0);
    }
  });

  it('rejects response with empty taskId', () => {
    const response = {
      responseType: 'neighborhood_task_updates_v1',
      taskUpdates: [
        {
          taskId: '',
          descriptionUpdate: 'Some update.',
          acceptanceCriteriaUpdate: null,
          reasoning: 'Because.',
        },
      ],
    };
    const result = parseNeighborhoodTaskUpdatesResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });

  it('rejects response with missing reasoning', () => {
    const response = {
      responseType: 'neighborhood_task_updates_v1',
      taskUpdates: [
        {
          taskId: 'task-1',
          descriptionUpdate: 'Some update.',
          acceptanceCriteriaUpdate: null,
        },
      ],
    };
    const result = parseNeighborhoodTaskUpdatesResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });

  it('rejects malformed text', () => {
    const result = parseNeighborhoodTaskUpdatesResponseFromText('not json at all');
    expect(result.ok).toBe(false);
  });

  it('repairs truncated JSON via jsonrepair fallback', () => {
    // Simulate a response where trailing characters are missing
    const full = JSON.stringify(validNeighborhoodTaskUpdatesResponse);
    const truncated = full.slice(0, -1); // drop final }
    const result = parseNeighborhoodTaskUpdatesResponseFromText(truncated);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskUpdates).toHaveLength(2);
    }
  });

  it('extracts JSON from fenced code block', () => {
    const text = `\`\`\`json\n${JSON.stringify(validNeighborhoodTaskUpdatesResponse)}\n\`\`\``;
    const result = parseNeighborhoodTaskUpdatesResponseFromText(text);
    expect(result.ok).toBe(true);
  });

  it('parses when string values contain inner markdown code fences', () => {
    const response = {
      responseType: 'neighborhood_task_updates_v1' as const,
      taskUpdates: [
        {
          taskId: 'task-1',
          descriptionUpdate:
            'Some description.\n\nType Definition:\n```yaml\nactivityDeltas:\n  type: ActivityDelta[]\n```',
          acceptanceCriteriaUpdate: null,
          reasoning: 'The description needed a type block.',
        },
      ],
    };
    const text = '```json\n' + JSON.stringify(response) + '\n```';
    const result = parseNeighborhoodTaskUpdatesResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskUpdates[0]!.descriptionUpdate).toContain('```yaml');
    }
  });
});

const validSetSplittingResponse = {
  responseType: 'set_splitting_v1' as const,
  splitMode: 'feature' as const,
  tasks: [
    {
      title: 'Implement auth login',
      description: 'Handle user login with JWT',
      acceptanceCriteria: 'User can log in and receive a JWT token',
    },
    {
      title: 'Implement auth logout',
      description: 'Handle user logout and token revocation',
      acceptanceCriteria: 'User can log out and token is invalidated',
    },
  ],
  reasoning: 'Split along login vs logout feature boundaries',
};

describe('parseSetSplittingResponseFromText', () => {
  it('parses valid set splitting response', () => {
    const text = JSON.stringify(validSetSplittingResponse);
    const result = parseSetSplittingResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('set_splitting_v1');
      expect(result.value.splitMode).toBe('feature');
      expect(result.value.tasks).toHaveLength(2);
      expect(result.value.reasoning).toBe('Split along login vs logout feature boundaries');
    }
  });

  it('parses service mode response', () => {
    const response = {
      ...validSetSplittingResponse,
      splitMode: 'service',
      tasks: [
        {
          title: 'API service changes',
          description: 'Update the API service',
          acceptanceCriteria: 'API endpoints work correctly',
        },
        {
          title: 'Worker service changes',
          description: 'Update the worker service',
          acceptanceCriteria: 'Worker processes jobs correctly',
        },
        {
          title: 'Gateway service changes',
          description: 'Update the gateway service',
          acceptanceCriteria: 'Gateway routes traffic correctly',
        },
      ],
    };
    const text = JSON.stringify(response);
    const result = parseSetSplittingResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.splitMode).toBe('service');
      expect(result.value.tasks).toHaveLength(3);
    }
  });

  it('extracts JSON from fenced code block', () => {
    const text = `\`\`\`json\n${JSON.stringify(validSetSplittingResponse)}\n\`\`\``;
    const result = parseSetSplittingResponseFromText(text);
    expect(result.ok).toBe(true);
  });

  it('rejects response with fewer than 2 tasks', () => {
    const response = {
      ...validSetSplittingResponse,
      tasks: [
        {
          title: 'Only one task',
          description: 'Not enough',
          acceptanceCriteria: 'Should fail',
        },
      ],
    };
    const result = parseSetSplittingResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });

  it('rejects response with empty tasks array', () => {
    const response = { ...validSetSplittingResponse, tasks: [] };
    const result = parseSetSplittingResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });

  it('rejects response with missing task fields', () => {
    const response = {
      ...validSetSplittingResponse,
      tasks: [
        { title: 'Task 1', description: 'Desc 1' },
        { title: 'Task 2', description: 'Desc 2', acceptanceCriteria: 'AC 2' },
      ],
    };
    const result = parseSetSplittingResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });

  it('rejects response with invalid splitMode', () => {
    const response = { ...validSetSplittingResponse, splitMode: 'random' };
    const result = parseSetSplittingResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });

  it('rejects response with wrong responseType', () => {
    const response = { ...validSetSplittingResponse, responseType: 'wrong' };
    const result = parseSetSplittingResponseFromText(JSON.stringify(response));
    expect(result.ok).toBe(false);
  });

  it('returns error for text without JSON', () => {
    const result = parseSetSplittingResponseFromText('no json here');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No JSON object found');
    }
  });
});

describe('parsePlanShapingFeatureSyncIterateResponseFromText', () => {
  const validResponse = {
    responseType: 'plan_shaping_feature_sync_iterate_v1',
    discrepancies: [
      {
        summary: 'Missing feature description',
        rationale: 'The feature needs a complete description',
        entityType: 'FEATURE',
        entityId: 'feature-1',
      },
    ],
    proposals: [
      {
        type: 'SINGLE',
        action: 'UPDATE',
        targetEntityId: 'task-1',
        targetEntityType: 'TASK',
        eli5: 'This proposal fills in the missing task detail.',
        updates: {
          name: 'Updated task name',
          description: 'Complete task description',
        },
      },
    ],
  };

  it('parses valid plan-shaping feature-sync iterate response from fenced JSON', () => {
    const text = `Here are the findings:\n\`\`\`json\n${JSON.stringify(validResponse)}\n\`\`\``;
    const result = parsePlanShapingFeatureSyncIterateResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('plan_shaping_feature_sync_iterate_v1');
      expect(result.value.discrepancies).toHaveLength(1);
      expect(result.value.discrepancies[0]!.summary).toBe('Missing feature description');
      expect(result.value.proposals).toHaveLength(1);
      expect(result.value.proposals[0]!.action).toBe('UPDATE');
    }
  });

  it('parses valid plan-shaping feature-sync iterate response from bare JSON', () => {
    const text = JSON.stringify(validResponse);
    const result = parsePlanShapingFeatureSyncIterateResponseFromText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.responseType).toBe('plan_shaping_feature_sync_iterate_v1');
      expect(result.value.discrepancies).toHaveLength(1);
      expect(result.value.proposals).toHaveLength(1);
    }
  });

  it('rejects response with wrong responseType', () => {
    const invalidResponse = { ...validResponse, responseType: 'wrong_type' };
    const text = JSON.stringify(invalidResponse);
    const result = parsePlanShapingFeatureSyncIterateResponseFromText(text);
    expect(result.ok).toBe(false);
  });

  it('rejects response missing discrepancies', () => {
    const { discrepancies: _, ...invalidResponse } = validResponse;
    const text = JSON.stringify(invalidResponse);
    const result = parsePlanShapingFeatureSyncIterateResponseFromText(text);
    expect(result.ok).toBe(false);
  });

  it('rejects response missing proposals', () => {
    const { proposals: _, ...invalidResponse } = validResponse;
    const text = JSON.stringify(invalidResponse);
    const result = parsePlanShapingFeatureSyncIterateResponseFromText(text);
    expect(result.ok).toBe(false);
  });

  it('returns error for text without JSON', () => {
    const result = parsePlanShapingFeatureSyncIterateResponseFromText('no json here');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No JSON object found');
    }
  });
});

describe('Goal PM routing parser preserves structured extraction', () => {
  it('parses a pretty-printed routing response after prose containing object syntax', () => {
    const response = {
      ...validGoalPmRoutingResponse,
    };
    const text =
      'I found a matching destination with { entityType: CONVERSATION }.\n' +
      JSON.stringify(response, null, 2) +
      '\nNo mutation has been performed.';

    const result = parseGoalPmRoutingResponseFromText(text);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.options[0]?.kind).toBe('existingConversation');
    }
  });
});
