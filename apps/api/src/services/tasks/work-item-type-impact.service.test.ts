import { WorkItemTypeImpactService } from './work-item-type-impact.service';
import { GoalTracksService } from './goal-tracks.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import { AgentEdgesService } from '../../generated/graphs/api/agentEdges.service';
import { of, throwError } from 'rxjs';
import * as TestUtils from '../../utils/testUtils';
import type { OrganizationId, ProjectId } from '../../types';

const ORG_ID = '00000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '00000000-0000-4000-8000-000000000002' as ProjectId;

describe('WorkItemTypeImpactService', () => {
  let prisma: ReturnType<typeof TestUtils.createMockPrismaService> & {
    db: ReturnType<typeof TestUtils.createMockPrismaService>['db'] & {
      taskSection: { count: jest.Mock };
    };
  };
  let goalTracksService: jest.Mocked<GoalTracksService>;
  let agentEdgeClient: jest.Mocked<AgentEdgeClientService>;
  let taskFindMany: jest.Mock;
  let findIncident: jest.Mock;
  let deleteIncidentAgentEdges: jest.Mock;
  let service: WorkItemTypeImpactService;

  beforeEach(() => {
    prisma = TestUtils.createMockPrismaService() as typeof prisma;
    prisma.db.taskSection = { count: jest.fn() };
    taskFindMany = jest.fn();
    prisma.db.task.findMany = taskFindMany;
    goalTracksService = {
      countRevokedTrackingSourceImpact: jest.fn(),
      clearRevokedTrackingSourceEdges: jest.fn(),
    } as unknown as jest.Mocked<GoalTracksService>;
    findIncident = jest.fn();
    agentEdgeClient = {
      findIncident,
    } as unknown as jest.Mocked<AgentEdgeClientService>;
    deleteIncidentAgentEdges = jest.fn();
    service = new WorkItemTypeImpactService(
      prisma as unknown as PrismaService,
      goalTracksService,
      agentEdgeClient,
      {
        deleteIncidentAgentEdges,
      } as unknown as AgentEdgesService,
    );
  });

  it('enumerates de-duplicated cascade work-item ids in the caller transaction', async () => {
    const tx = {
      task: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'item-b' },
            { id: 'item-a' },
            { id: 'item-a' },
          ]),
      },
    } as any;

    await expect(
      service.enumerateCascadeWorkItemIdsInTransaction(
        tx,
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
      ),
    ).resolves.toEqual(['item-a', 'item-b']);
    expect(tx.task.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        type: 'MARKETING',
      },
      select: { id: true },
    });
  });

  it('bulk-deletes incident graph edges and returns the de-duplicated graph count', async () => {
    deleteIncidentAgentEdges.mockReturnValue(
      of({ data: { deletedEdgeCount: 4 } }),
    );

    await expect(
      service.deleteCascadeIncidentEdges(
        ORG_ID,
        PROJECT_ID,
        ['item-a', 'item-b', 'item-a'],
        'token',
      ),
    ).resolves.toEqual({
      deletedEdgeCount: 4,
    });
    expect(findIncident).not.toHaveBeenCalled();
    expect(deleteIncidentAgentEdges).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      { nodeIds: new Set(['item-a', 'item-b']) },
      expect.objectContaining({
        config: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token',
          }),
          transformRequest: [expect.any(Function)],
        }),
      }),
    );
  });

  it('skips graph cleanup for an empty work-item set', async () => {
    await expect(
      service.deleteCascadeIncidentEdges(ORG_ID, PROJECT_ID, [], null),
    ).resolves.toEqual({ deletedEdgeCount: 0 });
    expect(findIncident).not.toHaveBeenCalled();
    expect(deleteIncidentAgentEdges).not.toHaveBeenCalled();
  });

  it('treats a Graph not-found response as an idempotent success', async () => {
    deleteIncidentAgentEdges.mockReturnValue(
      throwError(() => ({ response: { status: 404 } })),
    );

    await expect(
      service.deleteCascadeIncidentEdges(
        ORG_ID,
        PROJECT_ID,
        ['item-a'],
        'service-token',
      ),
    ).resolves.toEqual({ deletedEdgeCount: 0 });
  });

  it('counts active and archived items and de-duplicates incident edge ids', async () => {
    taskFindMany.mockResolvedValue([
      { id: 'item-active' },
      { id: 'item-archived' },
    ]);
    findIncident.mockResolvedValue([
      { id: 'edge-shared' },
      { id: 'edge-shared' },
      { id: 'edge-other' },
    ]);

    await expect(
      service.countCascadeImpact(ORG_ID, PROJECT_ID, 'MARKETING', 'token'),
    ).resolves.toEqual({ itemCount: 2, edgeCount: 2 });

    expect(taskFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        type: 'MARKETING',
      },
      select: { id: true },
    });
    expect(findIncident).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      expect.objectContaining({
        nodeIds: new Set(['item-active', 'item-archived']),
        types: expect.any(Set),
      }),
      'token',
    );
    const requestedTypes = findIncident.mock.calls[0]![2].types as Set<string>;
    expect(requestedTypes).toContain('TRACKS');
    expect(requestedTypes).toContain('FULFILLED_BY');
    expect(requestedTypes).not.toContain('PROPOSED_TOGETHER');
  });

  it('returns zero impact without querying graph edges when no items exist', async () => {
    taskFindMany.mockResolvedValue([]);

    await expect(
      service.countCascadeImpact(ORG_ID, PROJECT_ID, 'MARKETING', 'token'),
    ).resolves.toEqual({ itemCount: 0, edgeCount: 0 });
    expect(findIncident).not.toHaveBeenCalled();
  });

  it('rejects missing auth context before scanning items', async () => {
    await expect(
      service.countCascadeImpact(ORG_ID, PROJECT_ID, 'MARKETING', null),
    ).rejects.toThrow('authenticated user token');
    expect(taskFindMany).not.toHaveBeenCalled();
    expect(findIncident).not.toHaveBeenCalled();
  });

  it('counts section impact per removed key and distinct affected items without mutating sections', async () => {
    prisma.db.taskSection.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prisma.db.task.count.mockResolvedValue(2);

    await expect(
      service.countSectionContentImpact(ORG_ID, PROJECT_ID, 'MARKETING', [
        'brief',
        'audience',
      ]),
    ).resolves.toEqual({
      totalAffectedItemCount: 2,
      sections: [
        { sectionKey: 'audience', affectedItemCount: 2 },
        { sectionKey: 'brief', affectedItemCount: 1 },
      ],
    });

    expect(prisma.db.taskSection.count).toHaveBeenCalledTimes(2);
    expect(prisma.db.task.count).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        type: 'MARKETING',
        archivedAt: null,
        sections: {
          some: {
            key: { in: ['audience', 'brief'] },
            AND: [
              { materializedMarkdown: { not: null } },
              { materializedMarkdown: { not: '' } },
            ],
          },
        },
      },
    });
    expect(prisma.db.taskSection.count).toHaveBeenNthCalledWith(1, {
      where: {
        key: 'audience',
        AND: [
          { materializedMarkdown: { not: null } },
          { materializedMarkdown: { not: '' } },
        ],
        task: {
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          type: 'MARKETING',
          archivedAt: null,
        },
      },
    });
    expect((prisma.db as any).taskSection.deleteMany).toBeUndefined();
  });

  it('delegates tracking revocation impact to GoalTracksService', async () => {
    goalTracksService.countRevokedTrackingSourceImpact.mockResolvedValue({
      totalAffectedLinkCount: 1,
      sources: [{ sourceTypeKey: 'BUG', affectedLinkCount: 1 }],
    });

    await expect(
      service.countTrackingLinkRevocationImpact(
        ORG_ID,
        PROJECT_ID,
        'GOAL',
        ['BUG'],
        'token',
      ),
    ).resolves.toEqual({
      totalAffectedLinkCount: 1,
      sources: [{ sourceTypeKey: 'BUG', affectedLinkCount: 1 }],
    });
  });

  it('derives revoked tracking target keys from the accepted definition diff', () => {
    expect(
      service.deriveRevokedTrackingSourceTypeKeys(
        {
          definition: {
            key: 'GOAL',
            name: 'Goal',
            role: 'project-info',
            sections: [],
            allowedStatuses: [],
            tracking: {
              allowedSourceEntityTypes: ['TASK'],
              allowedSourceTaskTypes: ['BUG', 'FEATURE', 'STANDARD'],
            },
          },
        } as any,
        {
          key: 'GOAL',
          name: 'Goal',
          role: 'project-info',
          sections: [],
          allowedStatuses: [],
          tracking: {
            allowedSourceEntityTypes: ['TASK'],
            allowedSourceTaskTypes: ['FEATURE'],
          },
        },
      ),
    ).toEqual(['BUG', 'STANDARD']);
  });

  it('counts accepted definition edit impact using the same revoked-target diff', async () => {
    goalTracksService.countRevokedTrackingSourceImpact.mockResolvedValue({
      totalAffectedLinkCount: 2,
      sources: [
        { sourceTypeKey: 'BUG', affectedLinkCount: 1 },
        { sourceTypeKey: 'STANDARD', affectedLinkCount: 1 },
      ],
    });

    await expect(
      service.countTrackingLinkRevocationImpactForDefinitionEdit(
        ORG_ID,
        PROJECT_ID,
        {
          definition: {
            key: 'GOAL',
            name: 'Goal',
            role: 'project-info',
            sections: [],
            allowedStatuses: [],
            tracking: {
              allowedSourceEntityTypes: ['TASK'],
              allowedSourceTaskTypes: ['BUG', 'FEATURE', 'STANDARD'],
            },
          },
        } as any,
        {
          key: 'GOAL',
          name: 'Goal',
          role: 'project-info',
          sections: [],
          allowedStatuses: [],
          tracking: {
            allowedSourceEntityTypes: ['TASK'],
            allowedSourceTaskTypes: ['FEATURE'],
          },
        },
        'token',
      ),
    ).resolves.toEqual({
      totalAffectedLinkCount: 2,
      sources: [
        { sourceTypeKey: 'BUG', affectedLinkCount: 1 },
        { sourceTypeKey: 'STANDARD', affectedLinkCount: 1 },
      ],
    });
    expect(
      goalTracksService.countRevokedTrackingSourceImpact,
    ).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      'GOAL',
      ['BUG', 'STANDARD'],
      'token',
    );
  });

  it('reports cleared count from revoked tracking cleanup', async () => {
    goalTracksService.clearRevokedTrackingSourceEdges.mockResolvedValue({
      clearedLinkCount: 2,
      clearedEdges: [],
    });

    await expect(
      service.clearRevokedTrackingLinksForAcceptedEdit(
        ORG_ID,
        PROJECT_ID,
        'GOAL',
        ['BUG', 'STANDARD'],
        'token',
      ),
    ).resolves.toEqual({ clearedLinkCount: 2 });
  });
});
