import { ProjectAccessService } from '../../auth/services/project-access.service';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { executionGrantNotExpired } from '../../services/controller-authorization/controller-authorization-operations';
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

export type RoomScopeType =
  | 'organization'
  | 'project'
  | 'conversation'
  | 'initiative'
  | 'design_doc';

/** Server-side cause for a denied room. Logged, never sent to clients. */
export type RoomDenialReason =
  | 'not_found_or_inaccessible'
  | 'organization_access'
  | 'organization_not_entitled'
  | 'organization_scope_mismatch'
  | 'project_access'
  | 'ownership_inconsistent';

export interface DeniedRoomScope {
  scopeType: RoomScopeType;
  id: string;
  reason: RoomDenialReason;
}

export type ChildRoomScopeType = Exclude<RoomScopeType, 'organization'>;

export interface DeniedChildRoomScope extends DeniedRoomScope {
  scopeType: ChildRoomScopeType;
}

function isDeniedChildRoom(
  denied: DeniedRoomScope,
): denied is DeniedChildRoomScope {
  return denied.scopeType !== 'organization';
}

export interface GrantedRoomScope {
  projectIds: ProjectId[];
  conversationIds: ConversationId[];
  initiativeIds: InitiativeId[];
  designDocIds: DesignDocId[];
}

export interface WebsocketRoomAuthorizationDecision {
  authorized: boolean;
  grantedScope: GrantedRoomScope;
  deniedScopes: DeniedRoomScope[];
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

/**
 * A machine is authorized when its own binding and organization are valid.
 * Within that, rooms are granted individually: `deniedScopes` lists the
 * requested rooms left out, so one stale ID cannot block the rest.
 */
export interface MachineRoomAuthorizationDecision {
  authorized: boolean;
  deniedScopes: DeniedChildRoomScope[];
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

const unique = <T extends string>(ids: readonly T[]): T[] => [...new Set(ids)];

const machineDenied = (): MachineRoomAuthorizationDecision => ({
  authorized: false,
  deniedScopes: [],
  organizationIds: [],
  projectIds: [],
  conversationIds: [],
  initiativeIds: [],
  designDocIds: [],
  agentSessionIds: [],
  taskMonitorIds: [],
});

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
   * A missing, revoked or foreign-organization machine is denied outright.
   * Otherwise each requested room is granted or denied on its own, and the
   * denied rooms are returned so the caller can report them.
   * Session and grant bindings only contribute executable recipient ids.
   */
  async authorizeMachine(
    request: MachineRoomAuthorizationRequest,
  ): Promise<MachineRoomAuthorizationDecision> {
    const requestedOrganizations = unique(request.organizationIds);
    const machine = await this.prisma.db.machine.findFirst({
      where: { id: request.machineId, userId: request.userId },
      select: {
        organizationId: true,
        revokedAt: true,
      },
    });

    if (!machine || machine.revokedAt || !machine.organizationId) {
      this.logger.warn('Machine room authorization denied', {
        machineId: request.machineId,
        userId: request.userId,
        reason: !machine
          ? 'machine_not_found'
          : machine.revokedAt
            ? 'machine_revoked'
            : 'machine_unbound_to_organization',
      });
      return machineDenied();
    }

    const foreignOrganizationIds = requestedOrganizations.filter(
      (organizationId) => organizationId !== machine.organizationId,
    );
    if (foreignOrganizationIds.length > 0) {
      this.logger.warn('Machine room authorization denied', {
        machineId: request.machineId,
        userId: request.userId,
        reason: 'organization_scope_mismatch',
        machineOrganizationId: machine.organizationId,
        foreignOrganizationIds,
      });
      return machineDenied();
    }

    const organizationIds = [machine.organizationId as OrganizationId];
    const roomDecision = await this.authorize({
      userId: request.userId,
      organizationIds,
      projectIds: request.projectIds,
      conversationIds: request.conversationIds,
      initiativeIds: request.initiativeIds,
      designDocIds: request.designDocIds,
    });

    const deniedRooms = roomDecision.deniedScopes.filter(isDeniedChildRoom);
    if (deniedRooms.length < roomDecision.deniedScopes.length) {
      this.logger.warn('Machine room authorization denied', {
        machineId: request.machineId,
        userId: request.userId,
        reason: 'machine_organization_access',
        deniedScopes: roomDecision.deniedScopes.filter(
          (denied) => !isDeniedChildRoom(denied),
        ),
      });
      return machineDenied();
    }

    if (deniedRooms.length > 0) {
      this.logger.warn('Machine room authorization partially granted', {
        machineId: request.machineId,
        userId: request.userId,
        organizationId: machine.organizationId,
        deniedScopes: deniedRooms,
        grantedCounts: {
          projects: roomDecision.grantedScope.projectIds.length,
          conversations: roomDecision.grantedScope.conversationIds.length,
          initiatives: roomDecision.grantedScope.initiativeIds.length,
          designDocs: roomDecision.grantedScope.designDocIds.length,
        },
      });
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
          AND: [executionGrantNotExpired(now)],
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
      grantedScope: roomDecision.grantedScope,
      resolvedCounts: {
        agentSessions: allowedAgentSessionIds.length,
        taskMonitors: allowedTaskMonitorIds.length,
      },
    });

    return {
      authorized: true,
      deniedScopes: deniedRooms,
      organizationIds,
      ...roomDecision.grantedScope,
      agentSessionIds: allowedAgentSessionIds,
      taskMonitorIds: allowedTaskMonitorIds,
    };
  }

  /**
   * Decide every requested room separately. `authorized` is true only when
   * every requested room is allowed; `grantedScope` and `deniedScopes` let a
   * caller that accepts partial grants honor the allowed rooms. Entity lookups
   * use active-record predicates, so missing, deleted, archived and foreign
   * records all report `not_found_or_inaccessible`.
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

    const [memberships, projectMemberships, entitledOrganizationIds] =
      await Promise.all([
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
        this.resolveEntitledOrganizationIds(requiredOrganizationIds),
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
    const boundOrganizationIds = new Set<string>(organizationIds);

    const organizationDenial = (
      organizationId: string,
    ): RoomDenialReason | null => {
      if (!activeOrganizationIds.has(organizationId)) {
        return 'organization_access';
      }

      if (!entitledOrganizationIds.has(organizationId)) {
        return 'organization_not_entitled';
      }

      return null;
    };

    const entityDenial = (entity: OwnedEntity): RoomDenialReason | null => {
      if (
        boundOrganizationIds.size > 0 &&
        !boundOrganizationIds.has(entity.organizationId)
      ) {
        return 'organization_scope_mismatch';
      }

      const organizationReason = organizationDenial(entity.organizationId);
      if (organizationReason) {
        return organizationReason;
      }

      if (!entity.projectId) {
        return null;
      }

      const project = projectById.get(entity.projectId);
      if (!project || !currentProjectIds.has(entity.projectId)) {
        return 'project_access';
      }

      if (project.organizationId !== entity.organizationId) {
        return 'ownership_inconsistent';
      }

      return null;
    };

    const deniedScopes: DeniedRoomScope[] = [];
    const decide = <T extends string>(
      scopeType: RoomScopeType,
      ids: readonly T[],
      resolve: (id: T) => OwnedEntity | undefined,
    ): T[] =>
      ids.filter((id) => {
        const entity = resolve(id);
        const reason = entity
          ? entityDenial(entity)
          : 'not_found_or_inaccessible';
        if (reason) {
          deniedScopes.push({ scopeType, id, reason });
          return false;
        }

        return true;
      });

    for (const organizationId of organizationIds) {
      const reason = organizationById.has(organizationId)
        ? organizationDenial(organizationId)
        : 'not_found_or_inaccessible';
      if (reason) {
        deniedScopes.push({
          scopeType: 'organization',
          id: organizationId,
          reason,
        });
      }
    }

    const grantedScope: GrantedRoomScope = {
      projectIds: decide('project', projectIds, (id) => {
        const project = requestedProjectById.get(id);
        return project
          ? { organizationId: project.organizationId, projectId: project.id }
          : undefined;
      }),
      conversationIds: decide('conversation', conversationIds, (id) =>
        conversationById.get(id),
      ),
      initiativeIds: decide('initiative', initiativeIds, (id) => {
        const initiative = initiativeById.get(id);
        return initiative
          ? {
              organizationId: initiative.organizationId,
              projectId: initiative.originatingProjectId,
            }
          : undefined;
      }),
      designDocIds: decide('design_doc', designDocIds, (id) =>
        designDocById.get(id),
      ),
    };

    const authorized = deniedScopes.length === 0;

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
      deniedScopes,
    });

    return { authorized, grantedScope, deniedScopes };
  }

  /**
   * Check entitlement per organization so one lapsed organization does not
   * hide which rooms belong to entitled ones.
   */
  private async resolveEntitledOrganizationIds(
    organizationIds: readonly string[],
  ): Promise<Set<string>> {
    const decisions = await Promise.all(
      organizationIds.map(async (organizationId) => ({
        organizationId,
        entitled:
          await this.accountEntitlementService.areOrganizationsAuthorized([
            organizationId as OrganizationId,
          ]),
      })),
    );

    return new Set(
      decisions
        .filter((decision) => decision.entitled)
        .map((decision) => decision.organizationId),
    );
  }
}
