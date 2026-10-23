import { describe, expect, it, vi } from 'vitest';
import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  ExtendedUIFieldType,
  MessageStatus,
  SystemMessageDataTypeEnum,
} from '../../shared/api/generated/api';
import type { PromptTypeHandlerContext, PromptTypeHandlerDeps } from '../prompt-type-handler';
import type { ServerLogger } from '../../server/logger';
import { AgentSessionRunnerError } from '../providers/session-runner';
import { repositoryFeatureEnrichmentHandler } from './repository-feature-enrichment.handler';
import { validateTriggerPayload } from '../../server/conversation-dispatch/trigger-payload-schemas';
import type {
  RepositoryFeatureEnrichmentPromptPayload,
  RepositoryFeatureEnrichmentSuccessDecisionResult,
} from './types';

const analysis = {
  outcome: 'success' as const,
  serviceId: '44444444-4444-4444-8444-444444444444',
  provider: 'codex' as const,
  resolvedFrontierModel: 'gpt-6-astra',
  narrative: 'Repository discovery.',
  hierarchy: {
    topLevels: [
      {
        id: 'imports',
        name: 'Repository Imports',
        description: 'Import repository capabilities.',
        tag: 'product' as const,
        children: [
          {
            id: 'review',
            name: 'Import Review',
            description: 'Review imported capabilities.',
            tag: 'frontend' as const,
          },
          {
            id: 'legacy',
            name: 'Legacy import path',
            description: 'Legacy import behavior.',
            tag: 'backend' as const,
          },
        ],
      },
      {
        id: 'platform',
        name: 'Platform',
        description: 'Platform capabilities.',
        tag: 'backend' as const,
        children: [
          {
            id: 'service',
            name: 'Import service',
            description: 'Import service behavior.',
            tag: 'backend' as const,
          },
        ],
      },
    ],
  },
  evidence: [{ path: 'src/import.ts', summary: 'Repository import behavior.' }],
  briefDiscrepancies: [],
};

const payload = {
  promptType: LocalPromptType.RepositoryFeatureEnrichment,
  projectId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  workflowId: '33333333-3333-4333-8333-333333333333',
  workflowNodeId: 'onboarding-repository-feature-enrichment',
  serviceId: analysis.serviceId,
  machineId: '55555555-5555-4555-8555-555555555555',
  provider: analysis.provider,
  resolvedFrontierModel: analysis.resolvedFrontierModel,
  reasoningEffort: 'high' as const,
  fastMode: false,
  analysis,
  reviewedCandidates: analysis.hierarchy,
  completedRounds: 1,
  answerBatches: [
    {
      round: 1,
      answers: [{ question: 'Which users import repositories?', answer: 'Workspace admins.' }],
    },
  ],
} satisfies RepositoryFeatureEnrichmentPromptPayload;

const success = {
  ...analysis,
  support: [],
} satisfies RepositoryFeatureEnrichmentSuccessDecisionResult;

it('preserves reviewed corrections at trigger ingress and rejects a missing reviewed hierarchy', () => {
  const reviewedCandidates = {
    topLevels: payload.analysis.hierarchy.topLevels.map((root) => ({
      ...root,
      name: 'Reviewed capability',
    })),
  };
  const input = { ...payload, reviewedCandidates };
  expect(validateTriggerPayload(LocalPromptType.RepositoryFeatureEnrichment, input)).toEqual(input);
  const { reviewedCandidates: omitted, ...missingReviewedCandidates } = input;
  expect(() =>
    validateTriggerPayload(LocalPromptType.RepositoryFeatureEnrichment, missingReviewedCandidates),
  ).toThrow();
});

const evolvedSnapshot = {
  ...analysis,
  narrative: 'Repository discovery refined after the user answer.',
  evidence: [
    { path: 'src/import.ts', summary: 'Repository import behavior.' },
    { path: 'src/platform.ts', summary: 'Platform behavior.' },
    { path: 'src/new.ts', summary: 'New capability behavior.' },
  ],
  hierarchy: {
    topLevels: [
      {
        ...analysis.hierarchy.topLevels[0]!,
        children: [
          {
            ...analysis.hierarchy.topLevels[0]!.children[0]!,
            description: 'Workspace admins review imported capabilities.',
            tag: 'backend' as const,
          },
          { ...analysis.hierarchy.topLevels[1]!.children[0]! },
        ],
      },
      {
        ...analysis.hierarchy.topLevels[1]!,
        children: [
          {
            id: 'new-child',
            name: 'New capability',
            description: 'New capability behavior.',
            tag: 'frontend' as const,
          },
        ],
      },
    ],
  },
  support: [
    {
      candidateKey: 'review',
      detail: 'Workspace admins review imported capabilities.',
      source: 'user_answer' as const,
      answerRound: 1,
      answerQuestion: 'Which users import repositories?',
    },
    {
      candidateKey: 'service',
      detail: 'Moved under Repository Imports.',
      source: 'repository_evidence' as const,
      evidencePaths: ['src/platform.ts'],
    },
    {
      candidateKey: 'new-child',
      detail: 'New capability',
      source: 'repository_evidence' as const,
      evidencePaths: ['src/new.ts'],
    },
    {
      candidateKey: 'new-child',
      detail: 'New capability behavior.',
      source: 'repository_evidence' as const,
      evidencePaths: ['src/new.ts'],
    },
  ],
} satisfies RepositoryFeatureEnrichmentSuccessDecisionResult;

const eventFor = (value: object): AssistantCompleteEvent =>
  ({ summary: `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }) as AssistantCompleteEvent;

describe('repository-feature-enrichment handler', () => {
  const deps = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as PromptTypeHandlerDeps;

  it('uses a fresh read-only provider turn and no user-facing completion message', () => {
    expect(repositoryFeatureEnrichmentHandler).toMatchObject({
      id: 'repository-feature-enrichment',
      promptType: LocalPromptType.RepositoryFeatureEnrichment,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      readOnlyFilesystem: true,
      reports: [],
    });
    expect(repositoryFeatureEnrichmentHandler.resolveProviderExecution(payload)).toEqual({
      provider: payload.provider,
      model: payload.resolvedFrontierModel,
    });
  });

  it('preserves the Run-owned launch Service', async () => {
    const run = {
      agentic_session_id: 'run-1',
      launchServiceId: payload.serviceId,
      services: [{ id: payload.serviceId, path: '/workspace' }],
    } as unknown as AgenticSession;
    await expect(repositoryFeatureEnrichmentHandler.prepare(run, payload, deps)).resolves.toEqual({
      payload,
    });
    await expect(
      repositoryFeatureEnrichmentHandler.prepare(
        { ...run, launchServiceId: 'another-service' },
        payload,
        deps,
      ),
    ).rejects.toThrow('Run-owned launch workspace');
  });

  it('logs prompt metadata without the handler payload or rendered prompt', () => {
    const info = vi.fn();
    const logger = { info } as unknown as ServerLogger;
    const context = {
      runId: 'run-1',
      logger,
      recentUserReplies: [],
      triggerParentMessageId: null,
    } satisfies PromptTypeHandlerContext;

    const prompt = repositoryFeatureEnrichmentHandler.buildPrompt(payload, context);

    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      'repository_feature_enrichment.prompt_builder.started',
      expect.objectContaining({
        completedRounds: payload.completedRounds,
        answerBatchCount: payload.answerBatches.length,
        evidenceCount: payload.analysis.evidence.length,
        topLevelCount: payload.analysis.hierarchy.topLevels.length,
      }),
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      'repository_feature_enrichment.prompt_builder.completed',
      expect.objectContaining({ promptLength: prompt.length }),
    );
    expect(info.mock.calls[0]?.[1]).not.toHaveProperty('payload');
    expect(info.mock.calls[0]?.[1]).not.toHaveProperty('prompt');
    expect(info.mock.calls[1]?.[1]).not.toHaveProperty('payload');
    expect(info.mock.calls[1]?.[1]).not.toHaveProperty('prompt');
  });

  it('returns bounded questions and rejects repeated or post-limit questions', () => {
    const questions = eventFor({
      outcome: 'questions',
      questionGroup: { questions: ['Which workflows need imported Features?'] },
    });
    expect(repositoryFeatureEnrichmentHandler.validateCompletion(questions, payload)).toEqual({
      ok: true,
    });
    expect(
      repositoryFeatureEnrichmentHandler.getCompletionAction(questions, payload),
    ).toMatchObject({
      action: { action: 'questions' },
      hidden: true,
      userFacingResponse: '',
    });

    const repeated = eventFor({
      outcome: 'questions',
      questionGroup: { questions: ['Which users import repositories?'] },
    });
    expect(repositoryFeatureEnrichmentHandler.validateCompletion(repeated, payload)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_COMPLETION' },
    });
    const postLimit = repositoryFeatureEnrichmentHandler.validateCompletion(questions, {
      ...payload,
      completedRounds: 2,
      answerBatches: [
        ...payload.answerBatches,
        { round: 2, answers: [{ question: 'Second?', answer: 'Done.' }] },
      ],
    });
    expect(postLimit.ok).toBe(false);
  });

  it('accepts useful initial questions and evidence-supported zero-question success', () => {
    const initialPayload = {
      ...payload,
      completedRounds: 0,
      answerBatches: [],
    } satisfies RepositoryFeatureEnrichmentPromptPayload;
    expect(
      repositoryFeatureEnrichmentHandler.validateCompletion(
        eventFor({
          outcome: 'questions',
          questionGroup: { questions: ['Which workflows need imported Features?'] },
        }),
        initialPayload,
      ),
    ).toEqual({ ok: true });
    expect(
      repositoryFeatureEnrichmentHandler.validateCompletion(
        eventFor({
          outcome: 'questions',
          questionGroup: {
            questions: ['Who imports repositories?', 'Who reviews them?', 'What is missing?'],
          },
        }),
        initialPayload,
      ),
    ).toEqual({ ok: true });
    expect(
      repositoryFeatureEnrichmentHandler.validateCompletion(eventFor(success), initialPayload),
    ).toEqual({ ok: true });
  });

  it('returns a complete snapshot and permits supported evolution', () => {
    expect(
      repositoryFeatureEnrichmentHandler.validateCompletion(eventFor(evolvedSnapshot), payload),
    ).toEqual({ ok: true });
    expect(
      repositoryFeatureEnrichmentHandler.getCompletionAction(eventFor(evolvedSnapshot), payload),
    ).toEqual({
      action: { action: 'success', payload: evolvedSnapshot },
      hidden: true,
      userFacingResponse: '',
    });
  });

  it('rejects duplicate IDs, unknown evidence, and invalid answer support', () => {
    const duplicate = {
      ...success,
      hierarchy: {
        topLevels: [...analysis.hierarchy.topLevels, { ...analysis.hierarchy.topLevels[0]! }],
      },
    } satisfies RepositoryFeatureEnrichmentSuccessDecisionResult;
    expect(
      repositoryFeatureEnrichmentHandler.validateCompletion(eventFor(duplicate), payload),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_COMPLETION' },
    });

    expect(
      repositoryFeatureEnrichmentHandler.validateCompletion(
        eventFor({
          ...success,
          support: [
            {
              candidateKey: 'imports',
              detail: 'Import repository capabilities.',
              source: 'repository_evidence',
              evidencePaths: ['src/unknown.ts'],
            },
          ],
        }),
        payload,
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_COMPLETION' } });

    expect(
      repositoryFeatureEnrichmentHandler.validateCompletion(
        eventFor({
          ...success,
          support: [
            {
              candidateKey: 'imports',
              detail: 'Import repository capabilities.',
              source: 'user_answer',
              answerRound: 2,
              answerQuestion: 'Which users import repositories?',
            },
          ],
        }),
        payload,
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_COMPLETION' } });
  });

  it('maps provider completions to a hidden system message instead of exposing raw JSON', () => {
    const event = eventFor(success);
    expect(repositoryFeatureEnrichmentHandler.transformCompletionOutput(event)).toEqual({
      status: MessageStatus.Completed,
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response: 'Repository Feature enrichment completed.',
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        processResponseType: LocalPromptType.RepositoryFeatureEnrichment,
        uiElements: [
          {
            id: 'repository-feature-enrichment-completion',
            type: ExtendedUIFieldType.AgentHidden,
            label: 'Repository Feature enrichment completion',
          },
        ],
      },
    });
    expect(
      repositoryFeatureEnrichmentHandler.transformCompletionOutput({
        summary: 'not json',
      } as AssistantCompleteEvent),
    ).toBeNull();
  });

  it('maps malformed and runner failures into typed hidden outcomes', () => {
    expect(
      repositoryFeatureEnrichmentHandler.getCompletionAction(
        { summary: 'not json' } as AssistantCompleteEvent,
        payload,
      ),
    ).toMatchObject({
      action: { action: 'terminal_failure', payload: { code: 'invalid_completion' } },
      hidden: true,
    });
    expect(
      repositoryFeatureEnrichmentHandler.getRunnerFailureAction(
        new AgentSessionRunnerError('NOT_SUPPORTED', 'unsupported'),
      ),
    ).toMatchObject({
      action: { action: 'terminal_failure', payload: { code: 'unsupported_provider' } },
    });
    expect(
      repositoryFeatureEnrichmentHandler.getRunnerFailureAction(new Error('secret')),
    ).toMatchObject({
      action: { action: 'retryable_failure', payload: { code: 'provider_unavailable' } },
    });
  });
});
