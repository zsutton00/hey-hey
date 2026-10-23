import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { WebsocketAuthorizationService } from '../websocket-authorization.service';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';

const asId = <T extends string>(value: string): T => value as T;

function makeService(
  options: {
    projects?: Array<{ id: string; organizationId: string }>;
    conversations?: Array<{
      id: string;
      organizationId: string;
      projectId: string | null;
    }>;
    initiatives?: Array<{
      id: string;
      organizationId: string;
      originatingProjectId: string;
    }>;
    designDocs?: Array<{
      id: string;
      organizationId: string;
      projectId: string | null;
    }>;
    organizations?: Array<{ id: string }>;
    organizationMemberships?: Array<{ organizationId: string }>;
    projectMemberships?: Array<{ projectId: string }>;
    entitlementsAuthorized?: boolean;
    machine?: {
      organizationId: string | null;
      revokedAt: Date | null;
    } | null;
    agentSessions?: Array<{ id: string }>;
    executionGrants?: Array<{
      agentSessionId: string | null;
      taskMonitorId: string | null;
    }>;
  } = {},
) {
  const projectFindMany = jest.fn().mockResolvedValue(options.projects ?? []);
  const conversationFindMany = jest
    .fn()
    .mockResolvedValue(options.conversations ?? []);
  const initiativeFindMany = jest
    .fn()
    .mockResolvedValue(options.initiatives ?? []);
  const designDocFindMany = jest
    .fn()
    .mockResolvedValue(options.designDocs ?? []);
  const organizationFindMany = jest
    .fn()
    .mockResolvedValue(options.organizations ?? []);
  const organizationMemberFindMany = jest
    .fn()
    .mockResolvedValue(options.organizationMemberships ?? []);
  const projectMemberFindMany = jest
    .fn()
    .mockResolvedValue(options.projectMemberships ?? []);
  const machineFindFirst = jest.fn().mockResolvedValue(options.machine ?? null);
  const agentSessionFindMany = jest
    .fn()
    .mockResolvedValue(options.agentSessions ?? []);
  const executionGrantFindMany = jest
    .fn()
    .mockResolvedValue(options.executionGrants ?? []);

  const service = new WebsocketAuthorizationService(
    new ProjectAccessService({} as never),
    {
      db: {
        project: { findMany: projectFindMany },
        conversation: { findMany: conversationFindMany },
        initiative: { findMany: initiativeFindMany },
        designDoc: { findMany: designDocFindMany },
        organization: { findMany: organizationFindMany },
        organizationMember: { findMany: organizationMemberFindMany },
        projectMember: { findMany: projectMemberFindMany },
        machine: { findFirst: machineFindFirst },
        agentSession: { findMany: agentSessionFindMany },
        executionGrant: { findMany: executionGrantFindMany },
      },
    } as never,
    {
      areOrganizationsAuthorized: jest
        .fn()
        .mockResolvedValue(options.entitlementsAuthorized ?? true),
    } as unknown as AccountEntitlementService,
  );

  return {
    service,
    projectFindMany,
    organizationMemberFindMany,
    projectMemberFindMany,
    machineFindFirst,
    agentSessionFindMany,
    executionGrantFindMany,
  };
}

const request = {
  userId: asId<UserId>('user-1'),
  organizationIds: [asId<OrganizationId>('org-1')],
  projectIds: [asId<ProjectId>('project-1')],
  conversationIds: [],
  initiativeIds: [],
  designDocIds: [],
} as const;

describe('WebsocketAuthorizationService', () => {
  it('authorizes idle machine project and child rooms from current membership without a grant', async () => {
    const { service, agentSessionFindMany, executionGrantFindMany } =
      makeService({
        machine: { organizationId: 'org-1', revokedAt: null },
        projects: [{ id: 'project-1', organizationId: 'org-1' }],
        conversations: [
          {
            id: 'conversation-1',
            organizationId: 'org-1',
            projectId: 'project-1',
          },
        ],
        organizations: [{ id: 'org-1' }],
        organizationMemberships: [{ organizationId: 'org-1' }],
        projectMemberships: [{ projectId: 'project-1' }],
      });

    await expect(
      service.authorizeMachine({
        machineId: asId<MachineId>('machine-1'),
        userId: asId<UserId>('user-1'),
        organizationIds: [asId<OrganizationId>('org-1')],
        projectIds: [asId<ProjectId>('project-1')],
        conversationIds: [asId<ConversationId>('conversation-1')],
        initiativeIds: [],
        designDocIds: [],
      }),
    ).resolves.toEqual({
      authorized: true,
      organizationIds: ['org-1'],
      projectIds: ['project-1'],
      conversationIds: ['conversation-1'],
      initiativeIds: [],
      designDocIds: [],
      agentSessionIds: [],
      taskMonitorIds: [],
    });
    expect(agentSessionFindMany).toHaveBeenCalled();
    expect(executionGrantFindMany).toHaveBeenCalled();
  });

  it.each([
    ['membership loss', [], 'conversation-1'],
    [
      'a foreign child room',
      [{ projectId: 'project-1' }],
      'foreign-conversation',
    ],
  ])(
    'denies the complete machine room batch after %s without resolving executable scope',
    async (_reason, projectMemberships, conversationId) => {
      const { service, agentSessionFindMany, executionGrantFindMany } =
        makeService({
          machine: { organizationId: 'org-1', revokedAt: null },
          projects: [{ id: 'project-1', organizationId: 'org-1' }],
          conversations:
            conversationId === 'conversation-1'
              ? [
                  {
                    id: 'conversation-1',
                    organizationId: 'org-1',
                    projectId: 'project-1',
                  },
                ]
              : [],
          organizations: [{ id: 'org-1' }],
          organizationMemberships: [{ organizationId: 'org-1' }],
          projectMemberships,
        });

      await expect(
        service.authorizeMachine({
          machineId: asId<MachineId>('machine-1'),
          userId: asId<UserId>('user-1'),
          organizationIds: [asId<OrganizationId>('org-1')],
          projectIds: [asId<ProjectId>('project-1')],
          conversationIds: [asId<ConversationId>(conversationId)],
          initiativeIds: [],
          designDocIds: [],
        }),
      ).resolves.toEqual({
        authorized: false,
        organizationIds: [],
        projectIds: [],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
        agentSessionIds: [],
        taskMonitorIds: [],
      });
      expect(agentSessionFindMany).not.toHaveBeenCalled();
      expect(executionGrantFindMany).not.toHaveBeenCalled();
    },
  );

  it('authorizes an active organization member with current project access', async () => {
    const { service, organizationMemberFindMany, projectMemberFindMany } =
      makeService({
        projects: [{ id: 'project-1', organizationId: 'org-1' }],
        organizations: [{ id: 'org-1' }],
        organizationMemberships: [{ organizationId: 'org-1' }],
        projectMemberships: [{ projectId: 'project-1' }],
      });

    await expect(service.authorize(request)).resolves.toEqual({
      authorized: true,
    });
    expect(organizationMemberFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        organizationId: { in: ['org-1'] },
        isActive: true,
      },
      select: { organizationId: true },
    });
    expect(projectMemberFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        projectId: { in: ['project-1'] },
      },
      select: { projectId: true },
    });
  });

  it('denies a mixed batch when one requested entity is absent', async () => {
    const { service } = makeService({
      projects: [{ id: 'project-1', organizationId: 'org-1' }],
      organizations: [{ id: 'org-1' }],
      organizationMemberships: [{ organizationId: 'org-1' }],
      projectMemberships: [{ projectId: 'project-1' }],
    });

    await expect(
      service.authorize({
        ...request,
        conversationIds: [
          asId<ConversationId>('deleted-or-missing-conversation'),
        ],
      }),
    ).resolves.toEqual({ authorized: false });
  });

  it('denies a project-owned child when its current project membership is missing', async () => {
    const { service, projectFindMany } = makeService({
      projects: [{ id: 'project-1', organizationId: 'org-1' }],
      conversations: [
        {
          id: 'conversation-1',
          organizationId: 'org-1',
          projectId: 'project-1',
        },
      ],
      organizations: [{ id: 'org-1' }],
      organizationMemberships: [{ organizationId: 'org-1' }],
      projectMemberships: [],
    });

    const decision = await service.authorize({
      userId: asId<UserId>('user-1'),
      organizationIds: [],
      projectIds: [],
      conversationIds: [asId<ConversationId>('conversation-1')],
      initiativeIds: [],
      designDocIds: [],
    });

    expect(decision).toEqual({ authorized: false });
    expect(projectFindMany).toHaveBeenCalledTimes(2);
  });

  it('requires organization access for unassigned conversations and design documents', async () => {
    const { service } = makeService({
      conversations: [
        {
          id: 'conversation-1',
          organizationId: 'org-1',
          projectId: null,
        },
      ],
      designDocs: [
        {
          id: 'design-doc-1',
          organizationId: 'org-1',
          projectId: null,
        },
      ],
      organizations: [{ id: 'org-1' }],
      organizationMemberships: [],
    });

    await expect(
      service.authorize({
        userId: asId<UserId>('user-1'),
        organizationIds: [],
        projectIds: [],
        conversationIds: [asId<ConversationId>('conversation-1')],
        initiativeIds: [],
        designDocIds: [asId<DesignDocId>('design-doc-1')],
      }),
    ).resolves.toEqual({ authorized: false });
  });

  it('denies archived initiatives and deleted projects without distinguishing the cause', async () => {
    const { service } = makeService({
      organizations: [{ id: 'org-1' }],
      organizationMemberships: [{ organizationId: 'org-1' }],
      projectMemberships: [{ projectId: 'project-1' }],
    });

    await expect(
      service.authorize({
        userId: asId<UserId>('user-1'),
        organizationIds: [asId<OrganizationId>('org-1')],
        projectIds: [asId<ProjectId>('deleted-project')],
        conversationIds: [],
        initiativeIds: [asId<InitiativeId>('archived-initiative')],
        designDocIds: [],
      }),
    ).resolves.toEqual({ authorized: false });
  });

  it('denies otherwise valid rooms when current account access is revoked or expired', async () => {
    const { service } = makeService({
      projects: [{ id: 'project-1', organizationId: 'org-1' }],
      organizations: [{ id: 'org-1' }],
      organizationMemberships: [{ organizationId: 'org-1' }],
      projectMemberships: [{ projectId: 'project-1' }],
      entitlementsAuthorized: false,
    });

    await expect(service.authorize(request)).resolves.toEqual({
      authorized: false,
    });
  });
});
