import { EntityType, SummaryCategory } from '@prisma/client';
import * as TestUtils from 'src/utils/testUtils';
import { SubfacetCandidateService } from '../subfacet-candidate.service';
import { SubfacetLifecycleService } from '../subfacet-lifecycle.service';
import { SubfacetService } from '../subfacet.service';

describe('SubfacetLifecycleService', () => {
  const organizationId = TestUtils.testIds.organization;
  const projectId = TestUtils.testIds.project;

  it('direct-creates provisional when policy allows', async () => {
    const subfacetService = {
      createProvisionalSubfacet: jest.fn().mockResolvedValue({
        id: 'sf-1',
        name: 'runtime isolation',
      }),
    };
    const candidateService = {
      recordCandidate: jest.fn(),
    };
    const service = new SubfacetLifecycleService(
      subfacetService as unknown as SubfacetService,
      candidateService as unknown as SubfacetCandidateService,
    );

    const result = await service.handleProposedSubfacet({
      organizationId,
      projectId,
      category: SummaryCategory.technology,
      proposedNewSubfacetName: 'runtime isolation',
      sourceEntityType: EntityType.TASK,
      sourceEntityId: 'task-1',
      activeCount: 20,
      provisionalCount: 7,
      directCreatesThisRunForCategory: 1,
    });

    expect(subfacetService.createProvisionalSubfacet).toHaveBeenCalledWith(
      expect.objectContaining({
        category: SummaryCategory.technology,
        name: 'runtime isolation',
      }),
    );
    expect(candidateService.recordCandidate).not.toHaveBeenCalled();
    expect(result).toEqual({
      selectedSubfacetName: 'runtime isolation',
      activeCount: 20,
      provisionalCount: 8,
      directCreatesThisRunForCategory: 2,
    });
  });

  it('records candidate when direct-create policy does not allow', async () => {
    const subfacetService = {
      createProvisionalSubfacet: jest.fn(),
    };
    const candidateService = {
      recordCandidate: jest.fn().mockResolvedValue({ candidateId: 'cand-1' }),
    };
    const service = new SubfacetLifecycleService(
      subfacetService as unknown as SubfacetService,
      candidateService as unknown as SubfacetCandidateService,
    );

    const result = await service.handleProposedSubfacet({
      organizationId,
      projectId,
      category: SummaryCategory.technology,
      proposedNewSubfacetName: 'runtime isolation',
      proposedNewSubfacetConfidence: 0.9,
      proposedNewSubfacetRationale: 'new pattern',
      sourceEntityType: EntityType.TASK,
      sourceEntityId: 'task-1',
      activeCount: 20,
      provisionalCount: 8,
      directCreatesThisRunForCategory: 0,
    });

    expect(subfacetService.createProvisionalSubfacet).not.toHaveBeenCalled();
    expect(candidateService.recordCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: SummaryCategory.technology,
        name: 'runtime isolation',
        confidence: 0.9,
        rationale: 'new pattern',
      }),
    );
    expect(result).toEqual({
      activeCount: 20,
      provisionalCount: 8,
      directCreatesThisRunForCategory: 0,
    });
  });
});
