import { PlanLineageBoostService } from '../plan-lineage-boost.service';
import { OrganizationId, ProjectId } from '../../../types';
import { UnifiedSearchPlanLineageMode } from '../../../generated';

function fixture() {
  const db = {
    task: {
      findFirst: jest.fn().mockResolvedValue({ id: 'plan' }),
      findMany: jest.fn().mockResolvedValueOnce([{ id: 'stage' }]).mockResolvedValue([{ id: 'anchor' }, { id: 'upstream' }]),
    },
    taskDependency: { findMany: jest.fn().mockResolvedValue([{ dependentTaskId: 'anchor', dependencyTaskId: 'upstream' }]) },
    designDoc: { findFirst: jest.fn().mockResolvedValue({ parentEntityId: 'anchor' }), findMany: jest.fn().mockResolvedValue([{ id: 'root-document' }]) },
  };
  const service = new PlanLineageBoostService({ db } as never);
  const params = { organizationId: 'org' as OrganizationId, projectId: 'project' as ProjectId, planLineage: { mode: UnifiedSearchPlanLineageMode.WorkItemDependencies, planId: 'plan', taskId: 'anchor' } };
  return { db, service, params };
}

describe('canonical Plan dependency search boost', () => {
  it('boosts direct prerequisite work and documents owned by root prerequisites', async () => {
    const { service, params } = fixture();
    await expect(service.resolveBoostDeltas(params)).resolves.toEqual(new Map([['upstream', 0.3], ['root-document', 0.3]]));
  });
  it('scopes Plan lookup to organization and project', async () => {
    const { db, service, params } = fixture();
    await service.resolveBoostDeltas(params);
    expect(db.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'plan', organizationId: 'org', projectId: 'project', type: 'PLAN', archivedAt: null } }));
  });
  it('rejects a missing Plan', async () => {
    const { db, service, params } = fixture(); db.task.findFirst.mockResolvedValue(null);
    await expect(service.resolveBoostDeltas(params)).rejects.toThrow('Plan work item not found');
  });
  it('rejects a target outside the Plan', async () => {
    const { service, params } = fixture(); params.planLineage.taskId = 'outside';
    await expect(service.resolveBoostDeltas(params)).rejects.toThrow('not a work item in this Plan');
  });
  it('resolves a document anchor through its Task parent', async () => {
    const { service, params } = fixture();
    await expect(service.resolveBoostDeltas({ ...params, planLineage: { mode: params.planLineage.mode, planId: 'plan', designDocId: 'doc' } })).resolves.toHaveProperty('size', 2);
  });
  it('rejects ambiguous anchors', async () => {
    const { service, params } = fixture();
    await expect(service.resolveBoostDeltas({ ...params, planLineage: { ...params.planLineage, designDocId: 'doc' } })).rejects.toThrow('Exactly one');
  });
  it('rejects a dependency cycle back to the anchor', async () => {
    const { db, service, params } = fixture();
    db.taskDependency.findMany.mockResolvedValue([{ dependentTaskId: 'anchor', dependencyTaskId: 'upstream' }, { dependentTaskId: 'upstream', dependencyTaskId: 'anchor' }]);
    await expect(service.resolveBoostDeltas(params)).rejects.toThrow('cycle');
  });
});
