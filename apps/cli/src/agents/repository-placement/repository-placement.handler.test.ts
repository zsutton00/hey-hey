import { describe, expect, it } from 'vitest';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  ExtendedUIFieldType,
  MessageStatus,
  SystemMessageDataTypeEnum,
} from '../../shared/api/generated/api';
import type { AssistantCompleteEvent } from '../../run/types';
import { AgentSessionRunnerError } from '../providers/session-runner';
import { repositoryPlacementHandler } from './repository-placement.handler';
import type { RepositoryPlacementPromptPayload } from './types';

const rootKey = '11111111-1111-4111-8111-111111111111';
const childKey = '22222222-2222-4222-8222-222222222222';
const payload = {
  projectId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  workflowId: '55555555-5555-4555-8555-555555555555',
  workflowNodeId: 'placement',
  serviceId: '66666666-6666-4666-8666-666666666666',
  machineId: '77777777-7777-4777-8777-777777777777',
  provider: 'codex',
  resolvedFrontierModel: 'gpt-5.6-sol',
  reasoningEffort: 'high',
  candidates: [
    {
      rootKey,
      name: 'Reporting',
      description: 'Reporting',
      tag: 'product',
      children: [{ childKey, name: 'Reports', description: 'Reports', tag: 'frontend' }],
    },
  ],
  instructions: [{ rootKey, instruction: 'Select one parent.' }],
} satisfies RepositoryPlacementPromptPayload;

const event = (placements: unknown[]) =>
  ({ summary: JSON.stringify({ outcome: 'success', placements }) }) as never;

describe('repository placement handler', () => {
  it('mints a fresh provider turn with only bounded graph tools', () => {
    expect(repositoryPlacementHandler).toMatchObject({
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      mcpToolUseCase: 'repository_placement',
      builtinTools: [],
    });
  });

  it('preserves the accepted provider and model selection', () => {
    expect(repositoryPlacementHandler.resolveProviderExecution?.(payload)).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-sol',
    });
  });

  it('returns one hidden typed success for a complete root mapping', () => {
    const completion = event([
      {
        rootKey,
        target: { kind: 'PROJECT_ROOT' },
        rationale: 'It is a top-level capability.',
        confidence: 0.9,
      },
    ]);

    expect(repositoryPlacementHandler.validateCompletion?.(completion, payload)).toEqual({
      ok: true,
    });
    expect(repositoryPlacementHandler.getCompletionAction?.(completion, payload)).toMatchObject({
      action: { action: 'success' },
      hidden: true,
      userFacingResponse: '',
    });
  });

  it('replaces the raw provider JSON with a hidden placement completion message', () => {
    const completion = event([
      {
        rootKey,
        target: { kind: 'PROJECT_ROOT' },
        rationale: 'It is a top-level capability.',
        confidence: 0.9,
      },
    ]);

    expect(repositoryPlacementHandler.transformCompletionOutput?.(completion)).toEqual({
      status: MessageStatus.Completed,
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response: 'Repository placement analysis completed.',
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        processResponseType: LocalPromptType.RepositoryPlacement,
        uiElements: [
          {
            id: 'repository-placement-completion',
            type: ExtendedUIFieldType.AgentHidden,
            label: 'Repository placement completion',
          },
        ],
      },
    });
    expect(
      repositoryPlacementHandler.transformCompletionOutput?.({
        summary: 'not json',
      } as AssistantCompleteEvent),
    ).toBeNull();
  });

  it.each([
    ['missing', []],
    [
      'duplicate',
      [
        { rootKey, target: { kind: 'PROJECT_ROOT' }, rationale: 'one', confidence: 0.8 },
        { rootKey, target: { kind: 'PROJECT_ROOT' }, rationale: 'two', confidence: 0.8 },
      ],
    ],
    [
      'child',
      [
        {
          rootKey: childKey,
          target: { kind: 'PROJECT_ROOT' },
          rationale: 'child',
          confidence: 0.8,
        },
      ],
    ],
  ])('rejects %s root mappings', (_case, placements) => {
    expect(
      repositoryPlacementHandler.validateCompletion?.(event(placements), payload),
    ).toMatchObject({
      ok: false,
    });
  });

  it('closes aborted provider turns with a typed retryable failure', () => {
    expect(
      repositoryPlacementHandler.getRunnerFailureAction?.(
        new Error('Provider request aborted'),
        payload,
      ),
    ).toMatchObject({
      action: {
        action: 'retryable_failure',
        payload: {
          outcome: 'retryable_failure',
          code: 'provider_unavailable',
        },
      },
      hidden: true,
    });
  });

  it('closes unsupported providers with a typed terminal failure', () => {
    expect(
      repositoryPlacementHandler.getRunnerFailureAction?.(
        new AgentSessionRunnerError('NOT_SUPPORTED', 'Provider is unsupported'),
        payload,
      ),
    ).toMatchObject({
      action: {
        action: 'terminal_failure',
        payload: {
          outcome: 'terminal_failure',
          code: 'unsupported_provider',
        },
      },
      hidden: true,
    });
  });
});
