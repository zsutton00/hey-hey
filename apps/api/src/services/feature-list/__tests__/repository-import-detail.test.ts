import { FeatureListLifecycleService } from '../feature-list-lifecycle.service';
import { mapRepositoryGroundingSuccessToFeatureGeneration } from '../../../flows/nodes/onboarding/repository-grounding-review.mapper';
import { createMockFlowContext } from '../../../utils/testUtils';
import { createMutableContextHandle } from '../../../utils/mutable-context';
import type { RepositoryFeatureEnrichmentSuccess } from '../../../generated';
import type { RepositoryImportFlowContext } from '../../../types/flow-internal.types';

describe('repository outline and enriched draft lifecycle', () => {
  it('replaces the outline once, preserving candidate identity and Markdown through proposal and review', async () => {
    const detail =
      'Purpose: Review imports.\n\n## Behavior\nOperators review each candidate.\n\n## Boundaries\nApproval is required.\n\n## Dependencies\nRepository analysis.\n\n## Requirements\n- Keep accepted names.';
    const completion: RepositoryFeatureEnrichmentSuccess = {
      outcome: 'success',
      serviceId: 'service',
      provider: 'codex',
      resolvedFrontierModel: 'model',
      narrative: 'Import capabilities',
      evidence: [{ path: 'src/import.ts', summary: 'Import review' }],
      briefDiscrepancies: [],
      hierarchy: {
        topLevels: [
          {
            id: 'candidate-root',
            name: 'Imports',
            description: detail,
            tag: 'product',
            children: [
              {
                id: 'candidate-review',
                name: 'Review',
                description: detail,
                tag: 'frontend',
              },
              {
                id: 'candidate-analysis',
                name: 'Analysis',
                description: 'Repository analysis',
                tag: 'AI',
              },
            ],
          },
        ],
      },
      support: [
        {
          candidateKey: 'candidate-root',
          detail,
          source: 'repository_evidence',
          evidencePaths: ['src/import.ts'],
        },
      ],
    };
    const members = ['root', 'review', 'analysis'].map((key) => ({
      memberId: `member-${key}`,
      reservedEntityId: `entity-${key}`,
    }));
    const snapshot = { members, currentRevision: 3 };
    const authoring = {
      start: jest
        .fn()
        .mockResolvedValue({ groupId: 'group', currentRevision: 1 }),
      addMembers: jest
        .fn()
        .mockResolvedValueOnce({
          members: members.slice(0, 1),
          currentRevision: 2,
        })
        .mockResolvedValue(snapshot),
      replacePrerequisites: jest.fn().mockResolvedValue(snapshot),
    };
    const approval = { reject: jest.fn().mockResolvedValue(undefined) };
    const decision = { approveAll: jest.fn() };
    const prisma = {
      db: {
        proposalGroupMember: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              members.map((member) => ({
                id: member.memberId,
                proposalId: `proposal-${member.memberId}`,
              })),
            ),
        },
      },
    };
    const lifecycle = new FeatureListLifecycleService(
      approval as never,
      authoring as never,
      {} as never,
      decision as never,
      prisma as never,
    );
    const context = createMockFlowContext({
      flowId: 'repository-import',
    }) as RepositoryImportFlowContext;
    context.repositoryGrounding = {
      prerequisites: { entryMode: 'existing_project' },
    } as RepositoryImportFlowContext['repositoryGrounding'];
    const tracker = createMutableContextHandle(context);
    const outline = mapRepositoryGroundingSuccessToFeatureGeneration({
      ...completion,
      hierarchy: {
        topLevels: completion.hierarchy.topLevels.map((root) => ({
          ...root,
          description: 'Outline',
        })),
      },
    });
    const initial = await lifecycle.createOrReuseDraft(
      outline,
      tracker,
      'review',
    );
    expect(initial.repositoryReviewPhase).toBe('outline');
    tracker.mutate((draft) => {
      draft.repositoryFeatureEnrichmentFinal = completion;
    });
    authoring.addMembers
      .mockResolvedValueOnce({
        members: members.slice(0, 1),
        currentRevision: 2,
      })
      .mockResolvedValue(snapshot);
    const enriched = await lifecycle.createOrReuseDraft(
      mapRepositoryGroundingSuccessToFeatureGeneration(completion),
      tracker,
      'review',
    );
    expect(approval.reject).toHaveBeenCalledTimes(1);
    expect(enriched.repositoryReviewPhase).toBe('enriched');
    expect(enriched.topLevels[0]).toMatchObject({
      candidateId: 'candidate-root',
      description: detail,
    });
    expect(enriched.topLevels[0]!.children[0]).toMatchObject({
      candidateId: 'candidate-review',
      description: detail,
    });
    expect(lifecycle.toReviewNodes(enriched)[0]!.description).toBe(detail);
    expect(
      authoring.addMembers.mock.calls[2][5][0].updates.sections[0].content,
    ).toBe(detail);
    expect(
      authoring.addMembers.mock.calls[3][5][0].updates.sections[0].content,
    ).toBe(detail);
    await lifecycle.createOrReuseDraft(
      mapRepositoryGroundingSuccessToFeatureGeneration(completion),
      tracker,
      'review',
    );
    expect(authoring.start).toHaveBeenCalledTimes(2);
    expect(decision.approveAll).not.toHaveBeenCalled();
  });
});
