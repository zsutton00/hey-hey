import { describe, expect, it } from 'vitest';
import { mapAgentOutputToSystemMessage, type MapAgentOutputInput } from './message-mapping';
import { MessageType, MessageStatus, SystemMessageDataTypeEnum } from '../shared/api/generated';

describe('plan-shaping feature-sync iterate response mapping', () => {
  const createTestInput = (text: string): MapAgentOutputInput => ({
    text,
    timestamp: '2024-01-01T00:00:00Z',
    projectId: 'project-1',
    conversationId: 'conv-1',
    parentMessageId: 'msg-1',
  });

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

  describe('tryParsePlanShapingFeatureSyncIterateResponse', () => {
    it('recognizes and parses plan-shaping feature-sync iterate response', () => {
      const text = `Here are the findings:\n\`\`\`json\n${JSON.stringify(validIterateResponse)}\n\`\`\``;
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      expect(result?.message.type).toBe(MessageType.System);
      expect(result?.message.status).toBe(MessageStatus.Open);
      expect(result?.message.data.type).toBe(SystemMessageDataTypeEnum.Questions);
      expect(result?.message.data.title).toBe('Feature Sync Review');
    });

    it('returns null for non-iterate responses', () => {
      const text = '{"responseType": "some_other_type"}';
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      // Should not be recognized as plan-shaping iterate response
      // but may be processed as another response type or return null
      expect(result).not.toBeNull();
      expect(result?.message.data.title).not.toBe('Feature Sync Review');
    });
  });

  describe('mapPlanShapingFeatureSyncIterateResponse', () => {
    it('creates a system message with Questions type and Open status', () => {
      const text = JSON.stringify(validIterateResponse);
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      expect(result?.message.type).toBe(MessageType.System);
      expect(result?.message.status).toBe(MessageStatus.Open);
      expect(result?.message.data.type).toBe(SystemMessageDataTypeEnum.Questions);
    });

    it('creates a system message with PlanShapingFeatureSyncReview UI element', () => {
      const text = JSON.stringify(validIterateResponse);
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      expect(result?.message.data.uiElements).toBeDefined();
      expect(result?.message.data.uiElements).toHaveLength(1);
      expect(result?.message.data.uiElements?.[0]?.type).toBe('plan_shaping_feature_sync_review');
      expect(result?.message.data.uiElements?.[0]?.label).toBe('Feature Sync Review');
    });

    it('preserves discrepancies and proposals in the UI element payload', () => {
      const text = JSON.stringify(validIterateResponse);
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      const payload = result?.message.data.uiElements?.[0]?.payload as unknown as {
        discrepancies: unknown[];
        proposals: unknown[];
      };

      expect(payload).toBeDefined();
      expect(payload.discrepancies).toHaveLength(1);
      expect(payload.discrepancies[0]).toMatchObject({
        summary: 'Missing feature description',
        rationale: 'The feature needs a complete description',
        entityType: 'FEATURE',
        entityId: 'feature-1',
      });

      expect(payload.proposals).toHaveLength(1);
      expect(payload.proposals[0]).toMatchObject({
        type: 'SINGLE',
        action: 'UPDATE',
        targetEntityId: 'task-1',
        targetEntityType: 'TASK',
      });
    });

    it('sets correct detectedIntent and intentConfidence', () => {
      const text = JSON.stringify(validIterateResponse);
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      expect(result?.message.data.detectedIntent).toBe('plan_shaping_feature_sync_iterate');
      expect(result?.message.data.intentConfidence).toBe(1.0);
    });

    it('bypasses completion detection and agent_complete element', () => {
      const text = JSON.stringify(validIterateResponse);
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      // Should not have agent_complete element
      const hasAgentComplete = result?.message.data.uiElements?.some(
        (el: { type: string }) => el.type === 'agent_complete',
      );
      expect(hasAgentComplete).toBe(false);
    });
  });

  describe('integration with response parser', () => {
    it('correctly parses and maps a complete iterate response', () => {
      const text = `Review the following issues:\n\`\`\`json\n${JSON.stringify(validIterateResponse)}\n\`\`\``;
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      expect(result?.message.status).toBe(MessageStatus.Open);
      expect(result?.message.data.title).toBe('Feature Sync Review');

      const payload = result?.message.data.uiElements?.[0]?.payload as unknown as {
        discrepancies: unknown[];
        proposals: unknown[];
      };

      expect(payload.discrepancies).toHaveLength(1);
      expect(payload.proposals).toHaveLength(1);
    });

    it('handles response with multiple discrepancies and proposals', () => {
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

      const text = JSON.stringify(multiItemResponse);
      const result = mapAgentOutputToSystemMessage(createTestInput(text));

      expect(result).not.toBeNull();
      const payload = result?.message.data.uiElements?.[0]?.payload as unknown as {
        discrepancies: unknown[];
        proposals: unknown[];
      };

      expect(payload.discrepancies).toHaveLength(2);
      expect(payload.proposals).toHaveLength(2);
    });
  });
});

describe('legacy structured response allowlisting', () => {
  const createTestInput = (text: string): MapAgentOutputInput => ({
    text,
    timestamp: '2024-01-01T00:00:00Z',
    projectId: 'project-1',
    conversationId: 'conv-1',
  });

  const startupPlan = {
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
  };

  it('keeps the generic startup-plan mapper available by default', () => {
    const result = mapAgentOutputToSystemMessage(createTestInput(JSON.stringify(startupPlan)));

    expect(result?.isStartupPlan).toBe(true);
    expect(result?.message.status).toBe(MessageStatus.Open);
    expect(result?.message.data.uiElements?.[0]?.type).toBe('coding_prompt_startup_plan');
  });

  it('does not parse startup-plan output when the caller provides an empty allowlist', () => {
    const result = mapAgentOutputToSystemMessage({
      ...createTestInput(JSON.stringify(startupPlan)),
      expectedResponseTypes: [],
    });

    expect(result?.isStartupPlan).toBe(false);
    expect(result?.message.status).toBe(MessageStatus.Completed);
    expect(result?.message.data.type).toBe(SystemMessageDataTypeEnum.Agent);
    expect(result?.message.data.uiElements).toBeUndefined();
    expect(result?.message.data.response).toBe(JSON.stringify(startupPlan));
  });
});
