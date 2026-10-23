import { EntityType } from 'src/generated';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { ProjectReportPlacementService } from '../project-report-placement.service';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const ids = {
  planStep: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  stage: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  plan: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
  feature: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  rootFeature: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
  featureTask: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  designDoc: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  session: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  unplaced: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};
const row = (
  seed: string,
  id: string,
  name: string,
  type: string,
  distance: number,
) => ({ seed_id: seed, id, name, type, distance: BigInt(distance) });

describe('ProjectReportPlacementService', () => {
  const db = {
    designDoc: { findMany: jest.fn() },
    agentSession: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const registry = {
    isHierarchyNode: jest.fn((type: string) => type === 'FEATURE'),
  };
  const service = new ProjectReportPlacementService(
    { db } as unknown as PrismaService,
    registry as unknown as WorkItemTypeRegistryService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    db.designDoc.findMany.mockResolvedValue([
      { id: ids.designDoc, parentEntityId: ids.featureTask },
    ]);
    db.agentSession.findMany.mockResolvedValue([
      { id: ids.session, entityId: ids.planStep },
    ]);
    const featureChain = (seed: string, offset: number) => [
      row(seed, ids.feature, 'Reports', 'FEATURE', offset),
      row(seed, ids.rootFeature, 'Workspace', 'FEATURE', offset + 1),
    ];
    db.$queryRaw.mockResolvedValue([
      row(ids.planStep, ids.planStep, 'Step', 'STANDARD', 0),
      row(ids.planStep, ids.stage, 'Stage', 'PLAN_STAGE', 1),
      row(ids.planStep, ids.plan, 'Plan', 'PLAN', 2),
      ...featureChain(ids.planStep, 3),
      row(ids.featureTask, ids.featureTask, 'Task', 'STANDARD', 0),
      ...featureChain(ids.featureTask, 1),
    ]);
  });

  it('resolves plan-owned, feature-only, design-doc, session and unplaced subjects in one walk', async () => {
    const placements = await service.resolve({
      organizationId,
      projectId,
      subjects: [
        { entityType: EntityType.Task, entityId: ids.planStep },
        { entityType: EntityType.Task, entityId: ids.featureTask },
        { entityType: EntityType.DesignDoc, entityId: ids.designDoc },
        { entityType: EntityType.AgentSession, entityId: ids.session },
        { entityType: EntityType.Task, entityId: ids.unplaced },
        { entityType: EntityType.Proposal, entityId: ids.unplaced },
      ],
    });
    const features = [
      { id: ids.feature, title: 'Reports' },
      { id: ids.rootFeature, title: 'Workspace' },
    ];
    const planOwned = { plan: { id: ids.plan, title: 'Plan' }, features };
    expect(placements.get(`TASK:${ids.planStep}`)).toEqual(planOwned);
    expect(placements.get(`AGENT_SESSION:${ids.session}`)).toEqual(planOwned);
    expect(placements.get(`TASK:${ids.featureTask}`)).toEqual({ features });
    expect(placements.get(`DESIGN_DOC:${ids.designDoc}`)).toEqual({
      features,
    });
    expect(placements.get(`TASK:${ids.unplaced}`)).toEqual({ features: [] });
    expect(placements.get(`PROPOSAL:${ids.unplaced}`)).toEqual({
      features: [],
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.designDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId, projectId }),
      }),
    );
    expect(db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId, projectId }),
      }),
    );
  });

  it('skips the walk when no subject has a task anchor', async () => {
    db.designDoc.findMany.mockResolvedValue([]);
    const placements = await service.resolve({
      organizationId,
      projectId,
      subjects: [{ entityType: EntityType.DesignDoc, entityId: ids.designDoc }],
    });
    expect(placements.get(`DESIGN_DOC:${ids.designDoc}`)).toEqual({
      features: [],
    });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
