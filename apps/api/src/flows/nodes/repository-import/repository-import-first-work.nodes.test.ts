import type { RepositoryGroundingSuccess } from 'src/generated';
import type { RepositoryImportFlowContext } from 'src/types/flow-internal.types';
import { createMutableContextHandle } from '../../../utils/mutable-context';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import { repositoryImportFlow } from '../../templates/repository-import.flow';
import { RepositoryImportReplyFormValidator } from '../../../services/repository-import-reply-form-validator';
import { routeRepositoryImportAfterFinalize } from '../../../workflows/repository-import-legacy-compatibility';
import {
  FIRST_WORK_REQUEST_FIELD,
  RepositoryImportFirstWorkQuestionNode,
} from './repository-import-first-work-question.node';
import {
  FIRST_WORK_FOLLOW_UP_FIELD,
  RepositoryImportFirstWorkFollowUpNode,
} from './repository-import-first-work-follow-up.node';
import { RepositoryImportFirstWorkNode } from './repository-import-first-work.node';

const featureId = '11111111-1111-4111-8111-111111111111';
const otherFeatureId = '22222222-2222-4222-8222-222222222222';
const taskProposalId = '33333333-3333-4333-8333-333333333333';
const featureProposalId = '55555555-5555-4555-8555-555555555555';

const analysis: RepositoryGroundingSuccess = {
  outcome: 'success',
  serviceId: '44444444-4444-4444-8444-444444444444',
  provider: 'codex',
  resolvedFrontierModel: 'gpt-6-astra',
  narrative: 'Baseline',
  hierarchy: { topLevels: [] },
  evidence: [{ path: 'src/import.ts', summary: 'Import behavior' }],
  briefDiscrepancies: [],
};

const baseContext = (
  overrides: Partial<RepositoryImportFlowContext> = {},
): RepositoryImportFlowContext =>
  ({
    core: {
      projectId: '66666666-6666-4666-8666-666666666666',
      organizationId: '77777777-7777-4777-8777-777777777777',
      conversationId: '88888888-8888-4888-8888-888888888888',
      workflowId: '99999999-9999-4999-8999-999999999999',
    },
    repositoryFeatureEnrichmentAcceptedAnalysis: analysis,
    repositoryGrounding: {
      prerequisites: {
        serviceId: analysis.serviceId,
        machineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      analysisConfiguration: {
        provider: 'codex',
        resolvedFrontierModel: analysis.resolvedFrontierModel,
        reasoningEffort: 'high',
      },
    },
    repositoryImportMaterializedFeatureIds: [featureId],
    repositoryFirstWorkRequest: 'Add CSV export',
    repositoryFirstWorkFollowUpRoundCount: 0,
    repositoryFirstWorkFollowUpAnswers: [],
    ...overrides,
  }) as unknown as RepositoryImportFlowContext;

const prismaWith = (proposals: unknown[]) =>
  ({
    db: { proposal: { findMany: jest.fn().mockResolvedValue(proposals) } },
  }) as never;

const success = {
  outcome: 'success',
  summary: 'Proposed a CSV export task.',
  taskProposalIds: [taskProposalId],
  featureProposalIds: [featureProposalId],
};

describe('repository import first-work stage', () => {
  it('routes FINALIZE through the question and agent to END', () => {
    const nodes = repositoryImportFlow.nodes;
    expect(nodes[REPOSITORY_IMPORT_NODES.FINALIZE]).toMatchObject({
      nextNode: REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION,
    });
    expect(nodes[REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION]).toMatchObject({
      nextNode: REPOSITORY_IMPORT_NODES.FIRST_WORK,
    });
    expect(nodes[REPOSITORY_IMPORT_NODES.FIRST_WORK]).toMatchObject({
      transitions: {
        questions: { nextNodeId: REPOSITORY_IMPORT_NODES.FIRST_WORK_FOLLOW_UP },
        success: { nextNodeId: REPOSITORY_IMPORT_NODES.END },
      },
    });
  });

  it('keeps pre-patch and pre-stage executions completing at END', () => {
    const route = (patched: boolean, ids?: string[]) =>
      routeRepositoryImportAfterFinalize({
        currentNodeId: REPOSITORY_IMPORT_NODES.FINALIZE,
        nextNodeId: REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION,
        firstWorkPatched: () => patched,
        context: { repositoryImportMaterializedFeatureIds: ids },
      });
    expect(route(false, [featureId])).toBe(REPOSITORY_IMPORT_NODES.END);
    expect(route(true)).toBe(REPOSITORY_IMPORT_NODES.END);
    expect(route(true, [featureId])).toBe(
      REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION,
    );
    expect(
      routeRepositoryImportAfterFinalize({
        currentNodeId: REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
        nextNodeId: REPOSITORY_IMPORT_NODES.FINALIZE,
        firstWorkPatched: () => {
          throw new Error('unrelated edges must not record a patch marker');
        },
        context: {},
      }),
    ).toBe(REPOSITORY_IMPORT_NODES.FINALIZE);
  });

  it('asks for the work with no skip option', async () => {
    const node = new RepositoryImportFirstWorkQuestionNode();
    const result = await node.execute(
      createMutableContextHandle(baseContext()),
    );
    expect(result.uiElements).toHaveLength(1);
    expect(result.uiElements?.[0]).toMatchObject({
      id: FIRST_WORK_REQUEST_FIELD,
      required: true,
    });
    expect(result.uiElements?.[0]).not.toHaveProperty('options');
  });

  it('allows at most one follow-up round', async () => {
    const node = new RepositoryImportFirstWorkNode(prismaWith([]));
    const tracker = createMutableContextHandle(
      baseContext({ repositoryFirstWorkFollowUpRoundCount: 1 }),
    );
    await node.processUserResponse(tracker, {
      data: {
        action: 'questions',
        payload: { outcome: 'questions', questionGroup: { questions: ['Q?'] } },
      },
    } as never);
    expect(tracker.getContext().repositoryFirstWorkLatestOutcome).toMatchObject(
      { outcome: 'terminal_failure', code: 'invalid_completion' },
    );
    await expect(
      node.determineRoutingFromAgentCompletion(
        tracker.getContext(),
        'questions',
      ),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY);

    const followUp = new RepositoryImportFirstWorkFollowUpNode();
    await expect(
      followUp.processUserResponse(tracker, {
        data: {
          [FIRST_WORK_FOLLOW_UP_FIELD]: {
            clarifyingAnswers: [{ question: 'Q?', answer: 'A.' }],
          },
        },
      } as never),
    ).rejects.toThrow('only one follow-up round');
  });

  it('completes only after proposals under imported Features', async () => {
    const valid = [
      {
        id: taskProposalId,
        action: 'CREATE',
        status: 'PENDING',
        targetEntityType: 'TASK',
        targetEntityId: 'new-task',
        updates: { parentTaskId: featureId },
      },
      {
        id: featureProposalId,
        action: 'UPDATE',
        status: 'PENDING',
        targetEntityType: 'TASK',
        targetEntityId: featureId,
        updates: {},
      },
    ];
    const node = new RepositoryImportFirstWorkNode(prismaWith(valid));
    const tracker = createMutableContextHandle(baseContext());
    await node.processUserResponse(tracker, {
      data: { action: 'success', payload: success },
    } as never);
    expect(tracker.getContext().repositoryFirstWorkFinal).toEqual(success);
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.END);

    const misplaced = new RepositoryImportFirstWorkNode(
      prismaWith([
        { ...valid[0], updates: { parentTaskId: otherFeatureId } },
        valid[1],
      ]),
    );
    const rejected = createMutableContextHandle(baseContext());
    await misplaced.processUserResponse(rejected, {
      data: { action: 'success', payload: success },
    } as never);
    expect(rejected.getContext().repositoryFirstWorkFinal).toBeUndefined();
    await expect(
      misplaced.determineRoutingFromAgentCompletion(
        rejected.getContext(),
        'success',
      ),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY);
  });

  it('admits only well-formed follow-up replies', () => {
    const validator = new RepositoryImportReplyFormValidator();
    const fields = [
      {
        id: FIRST_WORK_FOLLOW_UP_FIELD,
        type: 'question_group',
        label: 'First task details',
        required: true,
        influences: [],
      },
    ] as never;
    expect(() =>
      validator.assertCompleteAnswers(fields, {
        [FIRST_WORK_FOLLOW_UP_FIELD]: {
          clarifyingAnswers: [{ question: 'Q?', answer: 'A.' }],
        },
      }),
    ).not.toThrow();
    expect(() =>
      validator.assertCompleteAnswers(fields, {
        [FIRST_WORK_FOLLOW_UP_FIELD]: { clarifyingAnswers: [] },
      }),
    ).toThrow();
  });
});
