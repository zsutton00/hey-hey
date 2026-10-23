import type {
  RepositoryFeatureEnrichmentSuccess,
  RepositoryGroundingSuccess,
} from 'src/generated';
import type { RepositoryImportFlowContext as OnboardingFlowContext } from 'src/types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import {
  RepositoryFeatureEnrichmentNode,
  repositoryFeatureEnrichmentActions,
  validateRepositoryFeatureEnrichmentSuccess,
} from '../repository-feature-enrichment.node';
import {
  REPOSITORY_FEATURE_ENRICHMENT_QUESTION_FIELD,
  RepositoryFeatureEnrichmentQuestionsNode,
} from '../repository-feature-enrichment-questions.node';
import { RepositoryFeatureEnrichmentRecoveryNode } from '../repository-feature-enrichment-recovery.node';
import { mapRepositoryEnrichmentToGroundingPresentation } from '../repository-grounding-review.mapper';
import {
  ONBOARDING_NODES,
  REPOSITORY_IMPORT_NODES,
} from '../../../constants/node-ids';

const baseline: RepositoryGroundingSuccess = {
  outcome: 'success',
  serviceId: '44444444-4444-4444-8444-444444444444',
  provider: 'codex',
  resolvedFrontierModel: 'gpt-6-astra',
  narrative: 'Baseline',
  hierarchy: {
    topLevels: [
      {
        id: 'root',
        name: 'Imports',
        description: 'Import capabilities',
        tag: 'product',
        children: [
          {
            id: 'child',
            name: 'Review',
            description: 'Review imports',
            tag: 'frontend',
          },
          {
            id: 'legacy',
            name: 'Legacy import path',
            description: 'Legacy import behavior',
            tag: 'backend',
          },
        ],
      },
      {
        id: 'platform',
        name: 'Platform',
        description: 'Platform capabilities',
        tag: 'backend',
        children: [
          {
            id: 'service',
            name: 'Import service',
            description: 'Import service behavior',
            tag: 'backend',
          },
        ],
      },
    ],
  },
  evidence: [{ path: 'src/import.ts', summary: 'Import behavior' }],
  briefDiscrepancies: [],
};

const context = {
  repositoryFeatureEnrichmentAcceptedAnalysis: baseline,
  repositoryGrounding: {
    prerequisites: { serviceId: baseline.serviceId },
    analysisConfiguration: {
      provider: baseline.provider,
      resolvedFrontierModel: baseline.resolvedFrontierModel,
    },
  },
  repositoryFeatureEnrichmentCompletedRounds: 1,
  repositoryFeatureEnrichmentAnswerBatches: [
    {
      round: 1,
      answers: [{ question: 'Initial question?', answer: 'Initial answer.' }],
    },
  ],
} as unknown as OnboardingFlowContext;

describe('repository Feature enrichment boundary', () => {
  it('bounds every question group to one through three questions', () => {
    expect(
      repositoryFeatureEnrichmentActions.questions!.schema.safeParse({
        outcome: 'questions',
        questionGroup: { questions: ['One?'] },
      }).success,
    ).toBe(true);
    expect(
      repositoryFeatureEnrichmentActions.questions!.schema.safeParse({
        outcome: 'questions',
        questionGroup: { questions: ['One?', 'Two?', 'Three?', 'Four?'] },
      }).success,
    ).toBe(false);
  });

  it('keeps all completion branches hidden from user-wait semantics', () => {
    expect(
      Object.values(repositoryFeatureEnrichmentActions).every(
        (entry) => entry.waitForUser === false,
      ),
    ).toBe(true);
    expect(Object.keys(repositoryFeatureEnrichmentActions)).toEqual([
      'questions',
      'success',
      'retryable_failure',
      'terminal_failure',
    ]);
  });

  it('rejects changed Feature details without exact source support', () => {
    const baselineRoot = baseline.hierarchy.topLevels[0]!;
    const unsupported = {
      ...baseline,
      hierarchy: {
        topLevels: [
          {
            ...baselineRoot,
            description: 'Invented capability',
          },
        ],
      },
      support: [],
    } satisfies RepositoryFeatureEnrichmentSuccess;

    expect(
      validateRepositoryFeatureEnrichmentSuccess(unsupported, context),
    ).toContain('lacks exact evidence or answer support');
    expect(
      validateRepositoryFeatureEnrichmentSuccess(
        {
          ...unsupported,
          support: [
            {
              candidateKey: 'root',
              detail: 'Invented capability',
              source: 'repository_evidence',
              evidencePaths: ['src/import.ts'],
            },
          ],
        },
        context,
      ),
    ).toBeUndefined();
  });

  it('accepts a complete snapshot that evolves narrative, evidence, and hierarchy', () => {
    const enrichedNarrative = {
      ...baseline,
      narrative: 'An enriched repository-backed narrative.',
      evidence: [
        { path: 'src/import.ts', summary: 'Updated import behavior.' },
        { path: 'src/platform.ts', summary: 'Platform behavior.' },
        { path: 'src/new.ts', summary: 'New capability behavior.' },
      ],
      hierarchy: {
        topLevels: [
          {
            ...baseline.hierarchy.topLevels[0]!,
            children: [
              {
                ...baseline.hierarchy.topLevels[0]!.children[0]!,
                description: 'Workspace admins review imported capabilities.',
                tag: 'backend' as const,
              },
              {
                ...baseline.hierarchy.topLevels[1]!.children[0]!,
              },
            ],
          },
          {
            ...baseline.hierarchy.topLevels[1]!,
            children: [
              {
                id: 'new-child',
                name: 'New capability',
                description: 'New capability behavior',
                tag: 'frontend' as const,
              },
            ],
          },
        ],
      },
      support: [
        {
          candidateKey: 'child',
          detail: 'Workspace admins review imported capabilities.',
          source: 'user_answer' as const,
          answerRound: 1,
          answerQuestion: 'Initial question?',
        },
        {
          candidateKey: 'new-child',
          detail: 'New capability',
          source: 'repository_evidence' as const,
          evidencePaths: ['src/new.ts'],
        },
        {
          candidateKey: 'new-child',
          detail: 'New capability behavior',
          source: 'repository_evidence' as const,
          evidencePaths: ['src/new.ts'],
        },
        {
          candidateKey: 'service',
          detail: 'Moved under Imports.',
          source: 'repository_evidence' as const,
          evidencePaths: ['src/platform.ts'],
        },
      ],
    } satisfies RepositoryFeatureEnrichmentSuccess;
    expect(
      validateRepositoryFeatureEnrichmentSuccess(enrichedNarrative, context),
    ).toBeUndefined();
  });

  it('stores the returned evidence and discrepancies as the next accepted snapshot', async () => {
    const changedRepositoryData = {
      ...baseline,
      narrative: 'Updated repository narrative.',
      evidence: [{ path: 'src/updated.ts', summary: 'Updated evidence' }],
      briefDiscrepancies: [
        {
          summary: 'Updated discrepancy',
          rationale: 'Updated rationale',
          material: true as const,
        },
      ],
      support: [],
    } satisfies RepositoryFeatureEnrichmentSuccess;
    expect(
      validateRepositoryFeatureEnrichmentSuccess(
        changedRepositoryData,
        context,
      ),
    ).toBeUndefined();

    const node = new RepositoryFeatureEnrichmentNode();
    const tracker = createMutableContextHandle(durableContext());
    await node.processUserResponse(tracker, {
      data: { action: 'success', payload: changedRepositoryData },
    } as never);

    expect(
      tracker.getContext().repositoryFeatureEnrichmentAcceptedAnalysis,
    ).toEqual({
      outcome: changedRepositoryData.outcome,
      serviceId: changedRepositoryData.serviceId,
      provider: changedRepositoryData.provider,
      resolvedFrontierModel: changedRepositoryData.resolvedFrontierModel,
      narrative: changedRepositoryData.narrative,
      hierarchy: changedRepositoryData.hierarchy,
      evidence: changedRepositoryData.evidence,
      briefDiscrepancies: changedRepositoryData.briefDiscrepancies,
    });
    expect(
      tracker.getContext().repositoryFeatureEnrichmentAcceptedAnalysis,
    ).not.toHaveProperty('support');
    expect(tracker.getContext().repositoryFeatureEnrichmentFinal).toEqual(
      changedRepositoryData,
    );
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.GENERATE_FEATURES);
  });

  it('validates support against the returned snapshot rather than the prior one', () => {
    const baselineWithDiscrepancy = {
      ...baseline,
      evidence: [
        {
          path: 'src/import.ts',
          summary: 'Import behavior',
          lineStart: 10,
          lineEnd: 20,
        },
      ],
      briefDiscrepancies: [
        {
          summary: 'The brief omits import review.',
          rationale: 'The repository documents a review surface.',
          material: true as const,
          evidencePaths: ['src/import.ts'],
        },
      ],
    } satisfies RepositoryGroundingSuccess;
    const completion = {
      ...baselineWithDiscrepancy,
      evidence: [
        {
          lineEnd: 20,
          lineStart: 10,
          summary: 'Import behavior',
          path: 'src/import.ts',
        },
      ],
      briefDiscrepancies: [
        {
          evidencePaths: ['src/import.ts'],
          material: true as const,
          rationale: 'The repository documents a review surface.',
          summary: 'The brief omits import review.',
        },
      ],
      support: [],
    } satisfies RepositoryFeatureEnrichmentSuccess;

    expect(
      validateRepositoryFeatureEnrichmentSuccess(completion, {
        ...context,
        repositoryFeatureEnrichmentAcceptedAnalysis: baselineWithDiscrepancy,
      }),
    ).toBeUndefined();
  });

  const durableContext = (
    overrides: Partial<OnboardingFlowContext> = {},
  ): OnboardingFlowContext =>
    ({
      core: {
        projectId: '11111111-1111-4111-8111-111111111111',
        conversationId: '22222222-2222-4222-8222-222222222222',
        workflowId: '33333333-3333-4333-8333-333333333333',
      },
      repositoryFeatureEnrichmentAcceptedAnalysis: baseline,
      repositoryGrounding: {
        prerequisites: {
          serviceId: baseline.serviceId,
          machineId: '55555555-5555-4555-8555-555555555555',
        },
        analysisConfiguration: {
          provider: baseline.provider,
          resolvedFrontierModel: baseline.resolvedFrontierModel,
          reasoningEffort: 'high',
          fastMode: false,
        },
      },
      repositoryFeatureEnrichmentCompletedRounds: 1,
      repositoryFeatureEnrichmentAnswerBatches: [
        {
          round: 1,
          answers: [
            {
              question: 'Which users import repositories?',
              answer: 'Workspace admins.',
            },
          ],
        },
      ],
      ...overrides,
    }) as unknown as OnboardingFlowContext;

  const success = {
    ...baseline,
    outcome: 'success' as const,
    support: [],
  } satisfies RepositoryFeatureEnrichmentSuccess;

  it('projects internal enrichment support out of the Feature-review message payload', () => {
    const presentation = mapRepositoryEnrichmentToGroundingPresentation({
      ...success,
      support: [
        {
          candidateKey: 'root',
          detail: 'Import capabilities',
          source: 'repository_evidence',
          evidencePaths: ['src/import.ts'],
        },
      ],
    });

    expect(presentation).toEqual(baseline);
    expect(presentation).not.toHaveProperty('support');
  });

  it('rebuilds every enrichment request from the accepted snapshot, answers, and runtime selection', async () => {
    const node = new RepositoryFeatureEnrichmentNode();
    const trigger = await node.buildTriggerMessage(
      createMutableContextHandle(durableContext()),
    );

    expect(trigger.triggersAgent).toMatchObject({
      promptType: 'repository_feature_enrichment',
      nodeId: ONBOARDING_NODES.REPOSITORY_FEATURE_ENRICHMENT,
      payload: {
        analysis: baseline,
        completedRounds: 1,
        answerBatches: [
          {
            round: 1,
            answers: [
              {
                question: 'Which users import repositories?',
                answer: 'Workspace admins.',
              },
            ],
          },
        ],
        provider: baseline.provider,
        resolvedFrontierModel: baseline.resolvedFrontierModel,
        reasoningEffort: 'high',
        fastMode: false,
      },
    });
  });

  it('projects a persisted pre-migration baseline to the lean request shape', async () => {
    const node = new RepositoryFeatureEnrichmentNode();
    const legacyBaseline = {
      ...baseline,
      limits: {
        maxFiles: 5000,
        maxTotalBytes: 25000000,
        maxFileBytes: 1000000,
        maxDepth: 12,
        maxGeneratedFiles: 1000,
        maxIgnoredFiles: 1000,
        maxUnsupportedFiles: 1000,
        maxBinaryFiles: 1000,
        filesRead: 4,
        totalBytesRead: 2048,
        maxDepthReached: 3,
      },
      omissions: [],
      confidence: 0.86,
      rationale: 'Legacy analysis bookkeeping.',
      coherenceChanges: [],
    };
    const trigger = await node.buildTriggerMessage(
      createMutableContextHandle(
        durableContext({
          repositoryFeatureEnrichmentAcceptedAnalysis: undefined,
          repositoryGroundingBaseline: legacyBaseline as never,
        }),
      ),
    );
    if (trigger.triggersAgent.promptType !== 'repository_feature_enrichment') {
      throw new Error('Expected a repository Feature enrichment trigger.');
    }
    const projectedBaseline = trigger.triggersAgent.payload.analysis;

    expect(projectedBaseline).toEqual(baseline);
    expect(projectedBaseline).not.toHaveProperty('limits');
    expect(projectedBaseline).not.toHaveProperty('omissions');
    expect(projectedBaseline).not.toHaveProperty('confidence');
    expect(projectedBaseline).not.toHaveProperty('rationale');
    expect(projectedBaseline).not.toHaveProperty('coherenceChanges');
  });

  it('stores final success separately and routes it into existing Feature review', async () => {
    const node = new RepositoryFeatureEnrichmentNode();
    const tracker = createMutableContextHandle(durableContext());
    await node.processUserResponse(tracker, {
      data: { action: 'success', payload: success },
    } as never);

    expect(
      tracker.getContext().repositoryFeatureEnrichmentAcceptedAnalysis,
    ).toEqual(baseline);
    expect(tracker.getContext().repositoryFeatureEnrichmentFinal).toEqual(
      success,
    );
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.GENERATE_FEATURES);
  });

  it('accepts evidence-supported success without any questions', async () => {
    const node = new RepositoryFeatureEnrichmentNode();
    const tracker = createMutableContextHandle(
      durableContext({
        repositoryFeatureEnrichmentCompletedRounds: 0,
        repositoryFeatureEnrichmentAnswerBatches: [],
      }),
    );

    await node.processUserResponse(tracker, {
      data: { action: 'success', payload: success },
    } as never);

    expect(
      tracker.getContext().repositoryFeatureEnrichmentLatestOutcome,
    ).toMatchObject({
      outcome: 'success',
    });
    expect(tracker.getContext().repositoryFeatureEnrichmentFinal).toEqual(
      success,
    );
  });

  it('accepts one useful initial question', async () => {
    const node = new RepositoryFeatureEnrichmentNode();
    const tracker = createMutableContextHandle(
      durableContext({
        repositoryFeatureEnrichmentCompletedRounds: 0,
        repositoryFeatureEnrichmentAnswerBatches: [],
      }),
    );

    await node.processUserResponse(tracker, {
      data: {
        action: 'questions',
        payload: {
          outcome: 'questions',
          questionGroup: { questions: ['Only one?'] },
        },
      },
    } as never);

    expect(
      tracker.getContext().repositoryFeatureEnrichmentLatestOutcome,
    ).toMatchObject({
      outcome: 'questions',
    });
  });

  it('rejects questions after the second completed round without erasing answers', async () => {
    const node = new RepositoryFeatureEnrichmentNode();
    const secondBatch = {
      round: 2,
      answers: [{ question: 'Which teams review?', answer: 'Product teams.' }],
    };
    const tracker = createMutableContextHandle(
      durableContext({
        repositoryFeatureEnrichmentCompletedRounds: 2,
        repositoryFeatureEnrichmentAnswerBatches: [
          ...durableContext().repositoryFeatureEnrichmentAnswerBatches!,
          secondBatch,
        ],
      }),
    );
    await node.processUserResponse(tracker, {
      data: {
        action: 'questions',
        payload: {
          outcome: 'questions',
          questionGroup: { questions: ['A third question?'] },
        },
      },
    } as never);

    expect(
      tracker.getContext().repositoryFeatureEnrichmentLatestOutcome,
    ).toMatchObject({
      outcome: 'terminal_failure',
      code: 'invalid_completion',
    });
    expect(
      tracker.getContext().repositoryFeatureEnrichmentAnswerBatches,
    ).toHaveLength(2);
    await expect(
      node.determineRoutingFromAgentCompletion(
        tracker.getContext(),
        'questions',
      ),
    ).resolves.toBe(ONBOARDING_NODES.REPOSITORY_FEATURE_ENRICHMENT_RECOVERY);
  });

  it('records the submitted answers and increments the API-owned round', async () => {
    const node = new RepositoryFeatureEnrichmentQuestionsNode();
    const questions = [
      'Who imports repositories?',
      'Who reviews the result?',
      'What detail is missing?',
    ];
    const tracker = createMutableContextHandle(
      durableContext({
        repositoryFeatureEnrichmentCompletedRounds: 0,
        repositoryFeatureEnrichmentAnswerBatches: [],
        repositoryFeatureEnrichmentLatestOutcome: {
          outcome: 'questions',
          questionGroup: { questions },
        },
      }),
    );
    const message = {
      data: {
        [REPOSITORY_FEATURE_ENRICHMENT_QUESTION_FIELD]: {
          clarifyingAnswers: [
            { question: questions[2], answer: 'The approval boundary.' },
            { question: 'A user-chosen label.', answer: 'Product teams.' },
            { question: questions[0], answer: 'Workspace admins.' },
          ],
        },
      },
    } as never;

    await node.processUserResponse(tracker, message);
    expect(tracker.getContext()).toMatchObject({
      repositoryFeatureEnrichmentCompletedRounds: 1,
      repositoryFeatureEnrichmentAnswerBatches: [
        {
          round: 1,
          answers: [
            { question: questions[2], answer: 'The approval boundary.' },
            { question: 'A user-chosen label.', answer: 'Product teams.' },
            { question: questions[0], answer: 'Workspace admins.' },
          ],
        },
      ],
    });
  });

  it('retries without clearing immutable discovery or accepted answer batches', async () => {
    const node = new RepositoryFeatureEnrichmentRecoveryNode();
    const tracker = createMutableContextHandle(
      durableContext({
        repositoryFeatureEnrichmentLatestOutcome: {
          outcome: 'retryable_failure',
          code: 'provider_timeout',
          message: 'Timed out.',
        },
      }),
    );
    await node.processUserResponse(tracker, {} as never);

    expect(
      tracker.getContext().repositoryFeatureEnrichmentLatestOutcome,
    ).toBeUndefined();
    expect(
      tracker.getContext().repositoryFeatureEnrichmentAcceptedAnalysis,
    ).toEqual(baseline);
    expect(
      tracker.getContext().repositoryFeatureEnrichmentAnswerBatches,
    ).toHaveLength(1);
  });
});
