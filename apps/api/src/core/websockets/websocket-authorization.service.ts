import { ProjectAccessService } from '../../auth/services/project-access.service';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountEntitlementService } from '../../services/account-entitlement.service';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';

export interface WebsocketRoomAuthorizationRequest {
  userId: UserId;
  organizationIds: readonly OrganizationId[];
  projectIds: readonly ProjectId[];
  conversationIds: readonly ConversationId[];
  initiativeIds: readonly InitiativeId[];
  designDocIds: readonly DesignDocId[];
}

export interface WebsocketRoomAuthorizationDecision {
  authorized: boolean;
}

export interface MachineRoomAuthorizationRequest {
  machineId: MachineId;
  userId: UserId;
  organizationIds: readonly OrganizationId[];
  projectIds: readonly ProjectId[];
  conversationIds: readonly ConversationId[];
  initiativeIds: readonly InitiativeId[];
  designDocIds: readonly DesignDocId[];
}

export interface MachineRoomAuthorizationDecision
  extends WebsocketRoomAuthorizationDecision {
  organizationIds: OrganizationId[];
  projectIds: ProjectId[];
  conversationIds: ConversationId[];
  initiativeIds: InitiativeId[];
  designDocIds: DesignDocId[];
  agentSessionIds: string[];
  taskMonitorIds: string[];
}

type OwnedEntity = {
  organizationId: string;
  projectId?: string | null;
};

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

@Injectable()
export class WebsocketAuthorizationService {
  private readonly logger = new Logger(WebsocketAuthorizationService.name);

  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly prisma: PrismaService,
    private readonly accountEntitlementService: AccountEntitlementService,
  ) {}

  /**
   * Authorize passive machine rooms from the verified owner and current access.
   * Session and grant bindings only contribute executable recipient ids.
   */
  async authorizeMachine(
    request: MachineRoomAuthorizationRequest,
  ): Promise<MachineRoomAuthorizationDecision> {
    const requestedOrganizations = unique(request.organizationIds);
    const requestedProjects = unique(request.projectIds);
    const requestedConversations = unique(request.conversationIds);
    const requestedInitiatives = unique(request.initiativeIds);
    const requestedDesignDocs = unique(request.designDocIds);
    const machine = await this.prisma.db.machine.findFirst({
      where: { id: request.machineId, userId: request.userId },
      select: {
        organizationId: true,
        revokedAt: true,
      },
    });
    const organizationIds = machine?.organizationId
      ? [machine.organizationId as OrganizationId]
      : [];

    if (!machine || machine.revokedAt || !machine.organizationId) {
      this.logger.debug(
        'Machine room authorization rejected before scope resolution',
        {
          machineId: request.machineId,
          userId: request.userId,
          machineFound: Boolean(machine),
          machineRevoked: Boolean(machine?.revokedAt),
          machineOrganizationBound: Boolean(machine?.organizationId),
          requestedOrganizationIds: requestedOrganizations,
          requestedProjectIds: requestedProjects,
          requestedConversationIds: requestedConversations,
          requestedInitiativeIds: requestedInitiatives,
          requestedDesignDocIds: requestedDesignDocs,
        },
      );
      return {
        authorized: false,
        organizationIds,
        projectIds: [],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
        agentSessionIds: [],
        taskMonitorIds: [],
      };
    }

    if (
      !requestedOrganizations.every(
        (organizationId) => organizationId === machine.organizationId,
      )
    ) {
      this.logger.debug('Machine organization room authorization denied', {
        machineId: request.machineId,
        userId: request.userId,
        requestedOrganizationCount: requestedOrganizations.length,
      });
      return {
        authorized: false,
        organizationIds: [],
        projectIds: [],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
        agentSessionIds: [],
        taskMonitorIds: [],
      };
    }

    const passiveRoomDecision = await this.authorize({
      userId: request.userId,
      organizationIds,
      projectIds: requestedProjects as ProjectId[],
      conversationIds: requestedConversations as ConversationId[],
      initiativeIds: requestedInitiatives as InitiativeId[],
      designDocIds: requestedDesignDocs as DesignDocId[],
    });
    if (!passiveRoomDecision.authorized) {
      this.logger.debug('Machine passive room authorization denied', {
        machineId: request.machineId,
        userId: request.userId,
        organizationId: machine.organizationId,
        requestedCounts: {
          organizations: requestedOrganizations.length,
          projects: requestedProjects.length,
          conversations: requestedConversations.length,
          initiatives: requestedInitiatives.length,
          designDocs: requestedDesignDocs.length,
        },
      });
      return {
        authorized: false,
        organizationIds: [],
        projectIds: [],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
        agentSessionIds: [],
        taskMonitorIds: [],
      };
    }

    const now = new Date();
    const [sessions, grants] = await Promise.all([
      this.prisma.db.agentSession.findMany({
        where: {
          machineId: request.machineId,
          userId: request.userId,
          organizationId: machine.organizationId,
        },
        select: { id: true },
      }),
      this.prisma.db.executionGrant.findMany({
        where: {
          machineId: request.machineId,
          userId: request.userId,
          organizationId: machine.organizationId,
          expiresAt: { gt: now },
          suspendedAt: null,
          terminalAt: null,
          revokedAt: null,
          controllerCredential: { revokedAt: null },
          authorization: {
            outcome: 'ADMITTED',
            consumedAt: { not: null },
            expiresAt: { gt: now },
            controllerCredential: { revokedAt: null },
          },
        },
        select: {
          agentSessionId: true,
          taskMonitorId: true,
        },
      }),
    ]);
    const allowedAgentSessionIds = unique([
      ...sessions.map((session) => session.id),
      ...grants.flatMap((grant) =>
        grant.agentSessionId ? [grant.agentSessionId] : [],
      ),
    ]);
    const allowedTaskMonitorIds = unique(
      grants.flatMap((grant) =>
        grant.taskMonitorId ? [grant.taskMonitorId] : [],
      ),
    );

    this.logger.debug('Machine room authorization granted', {
      machineId: request.machineId,
      userId: request.userId,
      authorized: true,
      requestedOrganizationIds: requestedOrganizations,
      requestedProjectIds: requestedProjects,
      requestedConversationIds: requestedConversations,
      requestedInitiativeIds: requestedInitiatives,
      requestedDesignDocIds: requestedDesignDocs,
      requestedCounts: {
        organizations: requestedOrganizations.length,
        projects: requestedProjects.length,
        conversations: requestedConversations.length,
        initiatives: requestedInitiatives.length,
        designDocs: requestedDesignDocs.length,
      },
      resolvedCounts: {
        organizations: organizationIds.length,
        agentSessions: allowedAgentSessionIds.length,
        taskMonitors: allowedTaskMonitorIds.length,
      },
    });

    return {
      authorized: true,
      organizationIds,
      projectIds: requestedProjects as ProjectId[],
      conversationIds: requestedConversations as ConversationId[],
      initiativeIds: requestedInitiatives as InitiativeId[],
      designDocIds: requestedDesignDocs as DesignDocId[],
      agentSessionIds: allowedAgentSessionIds,
      taskMonitorIds: allowedTaskMonitorIds,
    };
  }

  /**
   * Authorize a complete room request in one decision. Entity lookups use
   * findMany with active-record predicates so missing, deleted, archived, and
   * foreign records all collapse into the same externally observable denial.
   */
  async authorize(
    request: WebsocketRoomAuthorizationRequest,
  ): Promise<WebsocketRoomAuthorizationDecision> {
    const organizationIds = unique(request.organizationIds);
    const projectIds = unique(request.projectIds);
    const conversationIds = unique(request.conversationIds);
    const initiativeIds = unique(request.initiativeIds);
    const designDocIds = unique(request.designDocIds);

    const [requestedProjects, conversations, initiatives, designDocs] =
      await Promise.all([
        this.prisma.db.project.findMany({
          where: {
            ...this.projectAccess.projectWhere(request.userId),
            id: { in: projectIds },
          },
          select: { id: true, organizationId: true },
        }),
        this.prisma.db.conversation.findMany({
          where: {
            id: { in: conversationIds },
            status: { not: 'DELETED' },
          },
          select: { id: true, organizationId: true, projectId: true },
        }),
        this.prisma.db.initiative.findMany({
          where: {
            id: { in: initiativeIds },
            archivedAt: null,
            status: { not: 'ARCHIVED' },
          },
          select: {
            id: true,
            organizationId: true,
            originatingProjectId: true,
          },
        }),
        this.prisma.db.designDoc.findMany({
          where: {
            id: { in: designDocIds },
            archivedAt: null,
          },
          select: { id: true, organizationId: true, projectId: true },
        }),
      ]);

    const childProjectIds = [
      ...conversations.flatMap((entity) =>
        entity.projectId ? [entity.projectId] : [],
      ),
      ...initiatives.map((entity) => entity.originatingProjectId),
      ...designDocs.flatMap((entity) =>
        entity.projectId ? [entity.projectId] : [],
      ),
    ];
    const allProjectIds = unique([...projectIds, ...childProjectIds]);

    const projects =
      allProjectIds.length === projectIds.length &&
      allProjectIds.every((id) => projectIds.includes(id as ProjectId))
        ? requestedProjects
        : await this.prisma.db.project.findMany({
            where: {
              ...this.projectAccess.projectWhere(request.userId),
              id: { in: allProjectIds },
            },
            select: { id: true, organizationId: true },
          });

    const requestedProjectById = new Map<
      string,
      (typeof requestedProjects)[number]
    >(requestedProjects.map((project) => [String(project.id), project]));
    const projectById = new Map<string, (typeof projects)[number]>(
      projects.map((project) => [String(project.id), project]),
    );
    const conversationById = new Map<string, (typeof conversations)[number]>(
      conversations.map((conversation) => [
        String(conversation.id),
        conversation,
      ]),
    );
    const initiativeById = new Map<string, (typeof initiatives)[number]>(
      initiatives.map((initiative) => [String(initiative.id), initiative]),
    );
    const designDocById = new Map<string, (typeof designDocs)[number]>(
      designDocs.map((designDoc) => [String(designDoc.id), designDoc]),
    );

    const requestedEntities: OwnedEntity[] = [
      ...projects.map((project) => ({
        organizationId: project.organizationId,
        projectId: project.id,
      })),
      ...conversations.map((conversation) => ({
        organizationId: conversation.organizationId,
        projectId: conversation.projectId,
      })),
      ...initiatives.map((initiative) => ({
        organizationId: initiative.organizationId,
        projectId: initiative.originatingProjectId,
      })),
      ...designDocs.map((designDoc) => ({
        organizationId: designDoc.organizationId,
        projectId: designDoc.projectId,
      })),
    ];

    const requiredOrganizationIds = unique([
      ...organizationIds,
      ...requestedEntities.map((entity) => entity.organizationId),
    ]);
    const requiredProjectIds = unique(
      requestedEntities.flatMap((entity) =>
        entity.projectId ? [entity.projectId] : [],
      ),
    );

    const organizations =
      requiredOrganizationIds.length > 0
        ? await this.prisma.db.organization.findMany({
            where: {
              id: { in: requiredOrganizationIds },
              isActive: true,
            },
            select: { id: true },
          })
        : [];
    const organizationById = new Map<string, (typeof organizations)[number]>(
      organizations.map((organization) => [
        String(organization.id),
        organization,
      ]),
    );

    const [memberships, projectMemberships] = await Promise.all([
      requiredOrganizationIds.length > 0
        ? this.prisma.db.organizationMember.findMany({
            where: {
              userId: request.userId,
              organizationId: { in: requiredOrganizationIds },
              isActive: true,
            },
            select: { organizationId: true },
          })
        : Promise.resolve([]),
      requiredProjectIds.length > 0
        ? this.prisma.db.projectMember.findMany({
            where: {
              userId: request.userId,
              projectId: { in: requiredProjectIds },
            },
            select: { projectId: true },
          })
        : Promise.resolve([]),
    ]);

    const activeOrganizationIds = new Set<string>(
      memberships
        .filter((membership) =>
          organizationById.has(String(membership.organizationId)),
        )
        .map((membership) => String(membership.organizationId)),
    );
    const currentProjectIds = new Set<string>(
      projectMemberships.map((membership) => String(membership.projectId)),
    );
    const boundOrganizationIds = new Set(organizationIds);

    const allRequestedEntitiesExist =
      organizationIds.every((id) => organizationById.has(id)) &&
      projectIds.every((id) => requestedProjectById.has(id)) &&
      conversationIds.every((id) => conversationById.has(id)) &&
      initiativeIds.every((id) => initiativeById.has(id)) &&
      designDocIds.every((id) => designDocById.has(id));

    const entitiesHaveConsistentOwnership = requestedEntities.every(
      (entity) => {
        const project = entity.projectId
          ? projectById.get(entity.projectId)
          : undefined;

        return (
          (!entity.projectId ||
            project?.organizationId === entity.organizationId) &&
          (boundOrganizationIds.size === 0 ||
            boundOrganizationIds.has(entity.organizationId))
        );
      },
    );

    const organizationAccessIsValid = requiredOrganizationIds.every((id) =>
      activeOrganizationIds.has(id),
    );
    const projectAccessIsValid = requiredProjectIds.every(
      (id) => projectById.has(id) && currentProjectIds.has(id),
    );
    const entitlementAccessIsValid =
      await this.accountEntitlementService.areOrganizationsAuthorized(
        requiredOrganizationIds as OrganizationId[],
      );

    const authorized =
      allRequestedEntitiesExist &&
      entitiesHaveConsistentOwnership &&
      organizationAccessIsValid &&
      entitlementAccessIsValid &&
      projectAccessIsValid;

    this.logger.verbose('[websocket-authz] room decision', {
      userId: request.userId,
      authorized,
      requestedCounts: {
        organizations: organizationIds.length,
        projects: projectIds.length,
        conversations: conversationIds.length,
        initiatives: initiativeIds.length,
        designDocs: designDocIds.length,
      },
      resolvedCounts: {
        organizations: organizations.length,
        projects: projects.length,
        conversations: conversations.length,
        initiatives: initiatives.length,
        designDocs: designDocs.length,
      },
      checks: {
        allRequestedEntitiesExist,
        entitiesHaveConsistentOwnership,
        organizationAccessIsValid,
        entitlementAccessIsValid,
        projectAccessIsValid,
      },
    });

    return { authorized };
  }
}
