import { describe, expect, it } from 'vitest';
import type { AssistantCompleteEvent } from '../../run/types';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { validateTriggerPayload } from '../../server/conversation-dispatch/trigger-payload-schemas';
import { resolveMcpToolNames } from '../mcp-server-config';
import { repositoryFirstWorkHandler } from './repository-first-work.handler';
import type { RepositoryFirstWorkPromptPayload } from './types';

const payload: RepositoryFirstWorkPromptPayload = {
  promptType: 'repository_first_work',
  projectId: '66666666-6666-4666-8666-666666666666',
  conversationId: '88888888-8888-4888-8888-888888888888',
  workflowId: '99999999-9999-4999-8999-999999999999',
  workflowNodeId: 'repository-import-first-work',
  serviceId: '44444444-4444-4444-8444-444444444444',
  machineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  provider: 'codex',
  resolvedFrontierModel: 'gpt-6-astra',
  reasoningEffort: 'high',
  analysis: {
    outcome: 'success',
    serviceId: '44444444-4444-4444-8444-444444444444',
    provider: 'codex',
    resolvedFrontierModel: 'gpt-6-astra',
    narrative: 'Repository discovery.',
    hierarchy: {
      topLevels: [
        {
          id: 'imports',
          name: 'Repository Imports',
          description: 'Import repository capabilities.',
          tag: 'product',
          children: [
            {
              id: 'review',
              name: 'Import Review',
              description: 'Review imported capabilities.',
              tag: 'frontend',
            },
          ],
        },
      ],
    },
    evidence: [{ path: 'src/import.ts', summary: 'Import behavior.' }],
    briefDiscrepancies: [],
  },
  materializedFeatureIds: ['11111111-1111-4111-8111-111111111111'],
  workRequest: 'Add CSV export',
  followUpRoundCount: 0,
  followUpAnswers: [],
};

const event = (value: unknown) =>
  ({ summary: `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }) as AssistantCompleteEvent;

const success = {
  outcome: 'success',
  summary: 'Proposed a CSV export task.',
  taskProposalIds: ['33333333-3333-4333-8333-333333333333'],
  featureProposalIds: [],
};

describe('repository first-work handler', () => {
  it('accepts the complete-state trigger payload', () => {
    expect(validateTriggerPayload(LocalPromptType.RepositoryFirstWork, payload)).toEqual(payload);
    expect(() =>
      validateTriggerPayload(LocalPromptType.RepositoryFirstWork, {
        ...payload,
        followUpRoundCount: 1,
      }),
    ).toThrow();
  });

  it('can author proposals through the ordinary proposal tools', () => {
    const tools = resolveMcpToolNames({
      useCase: repositoryFirstWorkHandler.mcpToolUseCase,
      additionalTools: repositoryFirstWorkHandler.additionalAllowedTools,
    });
    expect(tools).toEqual(
      expect.arrayContaining(['create_work_item', 'edit_work_item', 'get_authoring_guidance']),
    );
  });

  it('forwards proposal ids on success', () => {
    expect(repositoryFirstWorkHandler.getCompletionAction(event(success), payload)).toMatchObject({
      action: { action: 'success', payload: success },
    });
  });

  it('rejects questions once the follow-up round is used', () => {
    const questions = { outcome: 'questions', questionGroup: { questions: ['Which format?'] } };
    expect(repositoryFirstWorkHandler.validateCompletion(event(questions), payload).ok).toBe(true);
    expect(
      repositoryFirstWorkHandler.validateCompletion(event(questions), {
        ...payload,
        followUpRoundCount: 1,
        followUpAnswers: [{ question: 'Which format?', answer: 'CSV.' }],
      }).ok,
    ).toBe(false);
  });

  it('requires at least one task proposal', () => {
    expect(
      repositoryFirstWorkHandler.getCompletionAction(
        event({ ...success, taskProposalIds: [] }),
        payload,
      ).action,
    ).toMatchObject({ action: 'terminal_failure' });
  });

  it('shows the success summary so attached proposals render for review', () => {
    expect(
      repositoryFirstWorkHandler.transformCompletionOutput(event(success))?.data,
    ).toMatchObject({
      response: success.summary,
      uiElements: [{ type: 'agent_response' }],
    });
  });
});
