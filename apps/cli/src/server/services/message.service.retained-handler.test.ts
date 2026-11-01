import { describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../../session/types';
import { repositoryFeatureEnrichmentHandler } from '../../agents/repository-feature-enrichment/repository-feature-enrichment.handler';
import { MessageService } from './message.service';

const session = {
  agentic_session_id: 'run-1',
  conversationId: 'conversation-1',
  promptType: LocalPromptType.RepositoryFeatureEnrichment,
  contextMetadata: { organizationId: 'org-1', projectId: 'project-1' },
} as AgenticSession;

describe('conversation dispatch after a workflow handoff', () => {
  it.each(['terminal', 'live-non-agent'] as const)(
    'uses the retained handler only when the workflow is %s',
    async (workflowState) => {
      const registry = new Map<LocalPromptType, typeof repositoryFeatureEnrichmentHandler>([
        [LocalPromptType.RepositoryFeatureEnrichment, repositoryFeatureEnrichmentHandler],
      ]);
      const service = new MessageService({
        promptTypeRegistry: {
          get: (type: LocalPromptType) =>
            type === LocalPromptType.FreeForm ? { promptType: type } : registry.get(type),
        },
        workflowsApi: {
          getConversationPromptType: vi.fn().mockResolvedValue({
            data: {
              data: {
                workflowState,
                promptType: LocalPromptType.FreeForm,
                nodeId: null,
                triggerMessageId: null,
              },
            },
          }),
        },
        logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never);
      const result = await service['resolveWireWorkflowDefined'](
        {
          promptType: LocalPromptType.WorkflowDefined,
          payload: { userMessage: 'Keep exploring' },
          references: { resolved: [], unresolved: [] },
        },
        session,
      );
      expect(result.promptType).toBe(
        workflowState === 'terminal'
          ? LocalPromptType.RepositoryFeatureEnrichment
          : LocalPromptType.CodingFreeform,
      );
      expect(result.triggerContext).toBeNull();
      expect(result.payload).toEqual({ userMessage: 'Keep exploring' });
    },
  );
});
