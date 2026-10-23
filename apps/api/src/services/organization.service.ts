import { ProjectMembershipRevocationService } from '../core/websockets/project-membership-revocation.service';
import { ProjectAccessService } from '../auth/services/project-access.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { OrganizationId, OrganizationMemberId, UserId } from 'src/types';
import { BrowserSessionRequestMetadata } from '../auth/browser-session.types';
import {
  BulkInviteResponse,
  BulkInviteResult,
  BulkInviteToOrganizationDto,
  CreateOrganizationDto,
  InviteToOrganizationDto,
  OrganizationMemberResponseDto,
  OrganizationDirectoryPageDto,
  OrganizationDirectoryRowDto,
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
  OrganizationResponseDto,
  UpdateOrganizationDto,
  AdminOrganizationDetailDto,
  AdminOrganizationMembersPageDto,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import {
  detectBatchAnomalies,
  validateEmailsBatch,
} from '../utils/enhanced-email-validation.util';
import { SecurityLoggerService } from './security-logger.service';
import { ApiKeyService } from './api-key.service';
import { ProjectService } from './project.service';
import { UserService } from './user.service';
import { EmailService } from './email.service';
import { AccountEntitlementService } from './account-entitlement.service';

type Transaction = Parameters<
  Parameters<PrismaService['db']['$transaction']>[0]
>[0];

const ORGANIZATION_DIRECTORY_DEFAULT_LIMIT = 25;
const ORGANIZATION_DIRECTORY_MAX_LIMIT = 100;
const ADMIN_ORGANIZATION_MEMBER_DEFAULT_LIMIT = 25;
const ADMIN_ORGANIZATION_MEMBER_MAX_LIMIT = 100;

type OrganizationDirectoryQuery = {
  name?: string;
  sortBy?: OrganizationDirectorySortBy;
  sortOrder?: OrganizationDirectorySortOrder;
  cursor?: string;
  limit?: string;
};

type OrganizationDirectorySortableRow = {
  id: OrganizationId;
  name: string;
  createdAt: string;
  memberCount: number;
};

type OrganizationDirectoryCursor = {
  version: 1;
  name: string;
  sortBy: OrganizationDirectorySortBy;
  sortOrder: OrganizationDirectorySortOrder;
  value: string | number;
  id: string;
};

type AdminOrganizationMemberQuery = {
  name?: string;
  cursor?: string;
  limit?: string;
};

type AdminOrganizationMemberCursor = {
  version: 1;
  name: string;
  membershipId: string;
};

const isOrganizationDirectorySortBy = (
  value: string | undefined,
): value is OrganizationDirectorySortBy =>
  value === OrganizationDirectorySortBy.Name ||
  value === OrganizationDirectorySortBy.CreatedAt ||
  value === OrganizationDirectorySortBy.MemberCount;

const isOrganizationDirectorySortOrder = (
  value: string | undefined,
): value is OrganizationDirectorySortOrder =>
  value === OrganizationDirectorySortOrder.Asc ||
  value === OrganizationDirectorySortOrder.Desc;

const compareDirectoryValues = (
  left: string | number,
  right: string | number,
): number => {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, {
    sensitivity: 'base',
  });
};

const getDirectorySortValue = (
  row: OrganizationDirectorySortableRow,
  sortBy: OrganizationDirectorySortBy,
): string | number => {
  switch (sortBy) {
    case OrganizationDirectorySortBy.Name:
      return row.name;
    case OrganizationDirectorySortBy.CreatedAt:
      return Date.parse(row.createdAt);
    case OrganizationDirectorySortBy.MemberCount:
      return row.memberCount;
  }

  throw new BadRequestException('Invalid organization directory sort field');
};

const compareDirectoryRows = (
  left: OrganizationDirectorySortableRow,
  right: OrganizationDirectorySortableRow,
  sortBy: OrganizationDirectorySortBy,
  sortOrder: OrganizationDirectorySortOrder,
): number => {
  const primary = compareDirectoryValues(
    getDirectorySortValue(left, sortBy),
    getDirectorySortValue(right, sortBy),
  );
  const direction = sortOrder === OrganizationDirectorySortOrder.Desc ? -1 : 1;

  return primary === 0
    ? direction * left.id.localeCompare(right.id)
    : direction * primary;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const encodeOrganizationDirectoryCursor = (
  cursor: OrganizationDirectoryCursor,
): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

const decodeOrganizationDirectoryCursor = (
  rawCursor: string,
  query: {
    name: string;
    sortBy: OrganizationDirectorySortBy;
    sortOrder: OrganizationDirectorySortOrder;
  },
): OrganizationDirectoryCursor => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(rawCursor, 'base64url').toString('utf8'),
    ) as unknown;
  } catch {
    throw new BadRequestException('Invalid organization directory cursor');
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.name !== query.name ||
    parsed.sortBy !== query.sortBy ||
    parsed.sortOrder !== query.sortOrder ||
    typeof parsed.id !== 'string' ||
    (typeof parsed.value !== 'string' && typeof parsed.value !== 'number')
  ) {
    throw new BadRequestException('Invalid organization directory cursor');
  }

  if (
    query.sortBy === OrganizationDirectorySortBy.Name
      ? typeof parsed.value !== 'string'
      : typeof parsed.value !== 'number' || !Number.isFinite(parsed.value)
  ) {
    throw new BadRequestException('Invalid organization directory cursor');
  }

  return {
    version: 1,
    name: query.name,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    value: parsed.value,
    id: parsed.id,
  };
};

const encodeAdminOrganizationMemberCursor = (
  cursor: AdminOrganizationMemberCursor,
) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

const decodeAdminOrganizationMemberCursor = (
  rawCursor: string,
  name: string,
): AdminOrganizationMemberCursor => {
  try {
    const parsed = JSON.parse(
      Buffer.from(rawCursor, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.name !== name ||
      typeof parsed.membershipId !== 'string'
    ) {
      throw new Error('invalid');
    }
    return { version: 1, name, membershipId: parsed.membershipId };
  } catch {
    throw new BadRequestException('Invalid organization member cursor');
  }
};

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    private readonly membershipRevocation: ProjectMembershipRevocationService,
    private readonly projectAccess: ProjectAccessService,
    private prisma: PrismaService,
    private securityLogger: SecurityLoggerService,
    private apiKeyService: ApiKeyService,
    @Inject(forwardRef(() => ProjectService))
    private projectService: ProjectService,
    @Inject(forwardRef(() => UserService))
    private userService: UserService,
    private emailService: EmailService,
    private accountEntitlementService: AccountEntitlementService,
  ) {}

  async getUserMemberships(userId: UserId) {
    try {
      this.logger.debug('[getUserMemberships] fetching user memberships', {
        userId,
      });
      return this.prisma.db.organizationMember.findMany({
        where: {
          userId,
          isActive: true,
        },
        include: {
          organization: true,
        },
      });
    } catch (error) {
      this.logger.error(
        '[getUserMemberships] error fetching user memberships',
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          userId,
        },
      );
      throw error;
    }
  }

  async getUserOrganizations(
    userId: UserId,
  ): Promise<OrganizationResponseDto[]> {
    const memberships = await this.getUserMemberships(userId);

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      description: membership.organization.description,
      isActive: membership.organization.isActive,
      settings: membership.organization.settings as object,
      createdAt: membership.organization.createdAt.toISOString(),
      updatedAt: membership.organization.updatedAt.toISOString(),
      userRole: membership.role,
    }));
  }

  async listOrganizationDirectory(
    query: OrganizationDirectoryQuery = {},
  ): Promise<OrganizationDirectoryPageDto> {
    const name = query.name?.trim() ?? '';
    if (name.length > 100) {
      throw new BadRequestException(
        'Organization directory name filter is too long',
      );
    }

    const sortBy = query.sortBy ?? OrganizationDirectorySortBy.CreatedAt;
    if (!isOrganizationDirectorySortBy(sortBy)) {
      throw new BadRequestException(
        'Invalid organization directory sort field',
      );
    }

    const sortOrder = query.sortOrder ?? OrganizationDirectorySortOrder.Desc;
    if (!isOrganizationDirectorySortOrder(sortOrder)) {
      throw new BadRequestException(
        'Invalid organization directory sort direction',
      );
    }

    const limit = query.limit
      ? Number(query.limit)
      : ORGANIZATION_DIRECTORY_DEFAULT_LIMIT;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > ORGANIZATION_DIRECTORY_MAX_LIMIT
    ) {
      throw new BadRequestException(
        `Organization directory limit must be between 1 and ${ORGANIZATION_DIRECTORY_MAX_LIMIT}`,
      );
    }

    const cursor = query.cursor
      ? decodeOrganizationDirectoryCursor(query.cursor, {
          name,
          sortBy,
          sortOrder,
        })
      : null;

    const organizations = await this.prisma.db.organization.findMany({
      where: name
        ? {
            name: {
              contains: name,
              mode: 'insensitive',
            },
          }
        : undefined,
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
          },
        },
      },
    });

    const sortedRows = organizations
      .map(
        (organization): OrganizationDirectorySortableRow => ({
          id: organization.id as OrganizationId,
          name: organization.name,
          createdAt: organization.createdAt.toISOString(),
          memberCount: organization._count.members,
        }),
      )
      .sort((left, right) =>
        compareDirectoryRows(left, right, sortBy, sortOrder),
      );

    const rowsAfterCursor = cursor
      ? sortedRows.filter((row) => {
          const primary = compareDirectoryValues(
            getDirectorySortValue(row, sortBy),
            cursor.value,
          );
          const direction =
            sortOrder === OrganizationDirectorySortOrder.Desc ? -1 : 1;
          return primary === 0
            ? direction * row.id.localeCompare(cursor.id) > 0
            : direction * primary > 0;
        })
      : sortedRows;

    const pageRows = rowsAfterCursor.slice(0, limit);
    const hasNextPage = rowsAfterCursor.length > pageRows.length;
    const lastRow = pageRows.at(-1);
    const nextCursor =
      hasNextPage && lastRow
        ? encodeOrganizationDirectoryCursor({
            version: 1,
            name,
            sortBy,
            sortOrder,
            value: getDirectorySortValue(lastRow, sortBy),
            id: lastRow.id,
          })
        : null;

    const organizationIds = pageRows.map((row) => row.id);
    const resolvedAt = new Date();
    const [entitlements, lifecycles] = await Promise.all([
      this.prisma.db.accountEntitlement.findMany({
        where: { organizationId: { in: organizationIds } },
      }),
      this.prisma.db.organizationAccountLifecycle.findMany({
        where: { organizationId: { in: organizationIds } },
      }),
    ]);
    const entitlementByOrganizationId = new Map(
      entitlements.map((entitlement) => [
        entitlement.organizationId,
        entitlement,
      ]),
    );
    const lifecycleByOrganizationId = new Map(
      lifecycles.map((lifecycle) => [lifecycle.organizationId, lifecycle]),
    );
    const directoryRows = pageRows.map((row): OrganizationDirectoryRowDto => {
      const entitlement = entitlementByOrganizationId.get(row.id);
      const resolution = this.accountEntitlementService.resolve(
        entitlement ?? null,
        resolvedAt,
        lifecycleByOrganizationId.get(row.id),
      );
      if (!resolution.subscriptionType) {
        throw new Error(
          `Organization ${row.id} is missing its canonical account entitlement`,
        );
      }
      return {
        ...row,
        subscriptionType: resolution.subscriptionType,
        accessStatus: resolution.status,
      };
    });

    return {
      organizations: directoryRows,
      totalCount: sortedRows.length,
      nextCursor,
    } satisfies OrganizationDirectoryPageDto;
  }

  async getAdminOrganizationDetail(
    organizationId: OrganizationId,
  ): Promise<AdminOrganizationDetailDto> {
    const [organization, taskGroups, sessions, entitlement, lifecycle] =
      await Promise.all([
        this.prisma.db.organization.findUnique({
          where: { id: organizationId },
          select: {
            id: true,
            name: true,
            createdAt: true,
            _count: { select: { members: true, projects: true } },
          },
        }),
        this.prisma.db.task.groupBy({
          by: ['type'],
          where: { organizationId },
          _count: { _all: true },
        }),
        this.prisma.db.agentSession.findMany({
          where: { organizationId },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 10,
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            projectId: true,
            updatedAt: true,
          },
        }),
        this.prisma.db.accountEntitlement.findUnique({
          where: { organizationId },
        }),
        this.prisma.db.organizationAccountLifecycle.findUnique({
          where: { organizationId },
          select: { accessEndsAt: true },
        }),
      ]);
    if (!organization) throw new NotFoundException('Organization not found');
    if (!entitlement)
      throw new NotFoundException('Organization entitlement not found');

    const resolvedEntitlement = this.accountEntitlementService.resolve(
      entitlement,
      new Date(),
      lifecycle,
    );

    const projectIds = await this.prisma.db.project.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const typeKeys = taskGroups.map((group) => group.type);
    const [overrides, templates, agentSessionsCreatedAllTime] =
      await Promise.all([
        this.prisma.db.workItemType.findMany({
          where: {
            projectId: { in: projectIds.map((project) => project.id) },
            typeKey: { in: typeKeys },
          },
          select: { typeKey: true, name: true },
        }),
        this.prisma.db.workItemTypeTemplate.findMany({
          where: { typeKey: { in: typeKeys } },
          select: { typeKey: true, name: true },
        }),
        this.prisma.db.agentSession.count({ where: { organizationId } }),
      ]);
    const labels = new Map(templates.map((type) => [type.typeKey, type.name]));
    overrides.forEach((type) => labels.set(type.typeKey, type.name));
    const workItemsByType = taskGroups
      .map((group) => ({
        typeKey: group.type,
        displayName: labels.get(group.type) ?? group.type,
        count: group._count._all,
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.displayName.localeCompare(right.displayName),
      );

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        createdAt: organization.createdAt.toISOString(),
        memberCount: organization._count.members,
        projectCount: organization._count.projects,
      },
      entitlement: {
        subscriptionType: entitlement.subscriptionType,
        accessStatus: resolvedEntitlement.status,
        accessThroughAt: entitlement.accessThroughAt?.toISOString() ?? null,
        paidThroughAt: entitlement.paidThroughAt?.toISOString() ?? null,
        effectiveAccessThroughAt:
          resolvedEntitlement.accessHorizon?.toISOString() ?? null,
        revision: entitlement.revision,
      },
      evidence: {
        workItemsCreatedAllTime: workItemsByType.reduce(
          (sum, item) => sum + item.count,
          0,
        ),
        agentSessionsCreatedAllTime,
        latestAgentSessionActivityAt:
          sessions[0]?.updatedAt.toISOString() ?? null,
        workItemsByType,
      },
      latestAgentSessions: sessions.map((session) => ({
        id: session.id,
        name: session.title,
        sessionType: session.type,
        lastActivityAt: session.updatedAt.toISOString(),
        status: session.status,
        projectId: session.projectId,
      })),
    } satisfies AdminOrganizationDetailDto;
  }

  async listAdminOrganizationMembers(
    organizationId: OrganizationId,
    callerId: UserId,
    query: AdminOrganizationMemberQuery = {},
  ): Promise<AdminOrganizationMembersPageDto> {
    const name = query.name?.trim() ?? '';
    if (name.length > 100)
      throw new BadRequestException(
        'Organization member name filter is too long',
      );
    const limit = query.limit
      ? Number(query.limit)
      : ADMIN_ORGANIZATION_MEMBER_DEFAULT_LIMIT;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > ADMIN_ORGANIZATION_MEMBER_MAX_LIMIT
    ) {
      throw new BadRequestException(
        `Organization member limit must be between 1 and ${ADMIN_ORGANIZATION_MEMBER_MAX_LIMIT}`,
      );
    }
    const organization = await this.prisma.db.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    const cursor = query.cursor
      ? decodeAdminOrganizationMemberCursor(query.cursor, name)
      : null;
    const memberWhere = {
      organizationId,
      isActive: true,
      ...(name
        ? { user: { name: { contains: name, mode: 'insensitive' as const } } }
        : {}),
    };
    if (
      cursor &&
      !(await this.prisma.db.organizationMember.findFirst({
        where: { ...memberWhere, id: cursor.membershipId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException('Invalid organization member cursor');
    }
    const [rows, totalCount] = await Promise.all([
      this.prisma.db.organizationMember.findMany({
        where: {
          ...memberWhere,
        },
        orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
        ...(cursor ? { cursor: { id: cursor.membershipId }, skip: 1 } : {}),
        take: limit + 1,
        select: {
          id: true,
          userId: true,
          role: true,
          user: {
            select: {
              name: true,
              email: true,
              lastLoginAt: true,
              _count: {
                select: {
                  projectMemberships: {
                    where: {
                      project: this.projectAccess.projectWhere(
                        callerId,
                        organizationId,
                      ),
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.db.organizationMember.count({ where: memberWhere }),
    ]);
    const pageRows = rows.slice(0, limit);
    return {
      members: pageRows.map((row) => ({
        userId: row.userId,
        name: row.user.name,
        email: row.user.email,
        organizationRole: row.role,
        projectCount: row.user._count.projectMemberships,
        lastActiveAt: row.user.lastLoginAt?.toISOString() ?? null,
      })),
      totalCount,
      nextCursor:
        rows.length > pageRows.length && pageRows.at(-1)
          ? encodeAdminOrganizationMemberCursor({
              version: 1,
              name,
              membershipId: pageRows.at(-1)!.id,
            })
          : null,
    } satisfies AdminOrganizationMembersPageDto;
  }

  async getOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationResponseDto> {
    try {
      // Verify user has access to this organization
      this.logger.debug('[getOrganization] verifying user access', {
        organizationId,
        userId,
      });
      const membership = await this.prisma.db.organizationMember.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
          isActive: true,
        },
        include: {
          organization: true,
        },
      });

      if (!membership) {
        throw new NotFoundException('Organization not found or access denied');
      }

      // Get member count
      this.logger.debug('[getOrganization] fetching member count', {
        organizationId,
      });
      const memberCount = await this.prisma.db.organizationMember.count({
        where: {
          organizationId,
          isActive: true,
        },
      });

      return {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        description: membership.organization.description,
        isActive: membership.organization.isActive,
        settings: membership.organization.settings as object,
        createdAt: membership.organization.createdAt.toISOString(),
        updatedAt: membership.organization.updatedAt.toISOString(),
        userRole: membership.role,
        memberCount,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('[getOrganization] error fetching organization', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        organizationId,
        userId,
      });
      throw new BadRequestException('Failed to fetch organization');
    }
  }

  private async createOrganizationInternal(
    tx: Transaction,
    data: CreateOrganizationDto & { slug: string },
    userId: UserId,
  ) {
    this.logger.debug(
      '[createOrganizationInternal] creating organization in tx',
      {
        name: data.name,
        slug: data.slug,
        userId,
      },
    );
    // Create organization
    const organization = await tx.organization.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
      },
    });

    // Add creator as owner
    this.logger.debug(
      '[createOrganizationInternal] adding creator as owner in tx',
      {
        userId,
        organizationId: organization.id,
      },
    );
    await tx.organizationMember.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationRole.OWNER,
        isActive: true,
        joinedAt: new Date(),
      },
    });

    // Ensure system user exists and add to organization
    const systemUserId = 'system';

    // Check if system user exists, create if not
    this.logger.debug(
      '[createOrganizationInternal] checking for system user in tx',
      {
        systemUserId,
      },
    );
    const existingSystemUser = await tx.user.findUnique({
      where: { id: systemUserId },
    });

    if (!existingSystemUser) {
      this.logger.debug(
        '[createOrganizationInternal] creating system user in tx',
        {
          systemUserId,
        },
      );
      await tx.user.create({
        data: {
          id: systemUserId,
          email: 'system@internal.local',
          name: 'System User',
          passwordHash:
            '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5Qt6Q8kR2/lBi', // System user password hash
          isActive: true,
        },
      });
    }

    // Add system user as member of the organization
    this.logger.debug(
      '[createOrganizationInternal] adding system user as member in tx',
      {
        systemUserId,
        organizationId: organization.id,
      },
    );
    await tx.organizationMember.create({
      data: {
        userId: systemUserId,
        organizationId: organization.id,
        role: OrganizationRole.MEMBER,
        isActive: true,
        joinedAt: new Date(),
      },
    });

    // Create Mastra.ai API key for the organization
    this.logger.debug(
      '[createOrganizationInternal] creating Mastra.ai API key in tx',
      {
        organizationId: organization.id,
        createdBy: userId,
      },
    );

    // Note: We're creating the API key record outside the transaction
    // since ApiKeyService doesn't support transaction passing yet
    // This is a temporary implementation - in production you'd want to
    // refactor ApiKeyService to accept transaction context

    return organization;
  }

  async createOrganizationWithTransaction(
    tx: Transaction,
    data: CreateOrganizationDto,
    userId: UserId,
  ) {
    const callerProvidedSlug = !!data.slug;
    let slug = data.slug || this.generateSlug(data.name);

    const existingOrg = await tx.organization.findUnique({
      where: { slug },
    });

    if (existingOrg) {
      if (callerProvidedSlug) {
        // User-driven path: caller asked for this exact slug, reject duplicates.
        throw new ForbiddenException('Organization slug already exists');
      }
      // Generated slug collided — auto-suffix until a free slug is found.
      const baseSlug = slug;
      let suffix = 2;
      while (
        await tx.organization.findUnique({
          where: { slug: `${baseSlug}-${suffix}` },
        })
      ) {
        suffix += 1;
      }
      slug = `${baseSlug}-${suffix}`;
      this.logger.log(
        `[createOrganizationWithTransaction] slug "${baseSlug}" collided; using "${slug}"`,
      );
    }

    return this.createOrganizationInternal(tx, { ...data, slug }, userId);
  }

  async createOrganization(
    data: CreateOrganizationDto,
    userId: UserId,
  ): Promise<OrganizationResponseDto> {
    try {
      this.logger.debug('[createOrganization] starting transaction', {
        name: data.name,
        userId,
      });
      const result = await this.prisma.db.$transaction(async (tx) => {
        try {
          return this.createOrganizationWithTransaction(tx, data, userId);
        } catch (err) {
          this.logger.error('[createOrganization] error in transaction', err);
          throw err;
        }
      });

      // Create Mastra.ai API key after successful organization creation
      try {
        this.logger.debug('[createOrganization] creating Mastra.ai API key', {
          organizationId: result.id,
          createdBy: userId,
        });

        await this.apiKeyService.createOrganizationApiKey(result.id, userId);

        this.logger.log(
          `Successfully created Mastra.ai API key for organization ${result.id}`,
        );
      } catch (keyError) {
        // Log error but don't fail organization creation
        this.logger.error(
          '[createOrganization] failed to create Mastra.ai API key',
          {
            error: (keyError as Error).message,
            organizationId: result.id,
            userId,
          },
        );
        // Organization was created successfully, API key can be created later
      }

      return {
        id: result.id,
        name: result.name,
        slug: result.slug,
        description: result.description,
        isActive: result.isActive,
        settings: result.settings as object,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        userRole: OrganizationRole.OWNER,
        memberCount: 1,
      };
    } catch (error) {
      this.logger.error('[createOrganization] error creating organization', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        data,
        userId,
      });
      throw error;
    }
  }

  async updateOrganization(
    organizationId: OrganizationId,
    data: UpdateOrganizationDto,
    userId: UserId,
  ): Promise<OrganizationResponseDto> {
    try {
      // Verify user has admin or owner role
      this.logger.debug('[updateOrganization] verifying user role', {
        organizationId,
        userId,
      });
      const userRole = await this.projectAccess.assertOrganizationRole(
        organizationId,
        userId,
        'updateOrganization',
      );

      this.logger.debug('[updateOrganization] updating organization', {
        organizationId,
        data,
      });
      const organization = await this.prisma.db.organization.update({
        where: { id: organizationId },
        data: {
          name: data.name,
          description: data.description,
          settings: data.settings,
        },
      });

      this.logger.debug('[updateOrganization] fetching member count', {
        organizationId,
      });
      const memberCount = await this.prisma.db.organizationMember.count({
        where: {
          organizationId,
          isActive: true,
        },
      });

      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        description: organization.description,
        isActive: organization.isActive,
        settings: organization.settings as object,
        createdAt: organization.createdAt.toISOString(),
        updatedAt: organization.updatedAt.toISOString(),
        userRole,
        memberCount,
      };
    } catch (error) {
      this.logger.error('[updateOrganization] error updating organization', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        organizationId,
        userId,
      });
      throw error;
    }
  }

  async getOrganizationMembers(
    organizationId: OrganizationId,
    userId: UserId,
    options?: {
      excludeSystemUser?: boolean;
    },
  ): Promise<OrganizationMemberResponseDto[]> {
    try {
      // Verify user has access to this organization
      this.logger.debug('[getOrganizationMembers] verifying user access', {
        organizationId,
        userId,
      });
      await this.projectAccess.assertOrganization(userId, organizationId);
      const excludeSystemUser = options?.excludeSystemUser ?? true;

      this.logger.debug('[getOrganizationMembers] fetching members', {
        organizationId,
      });
      const members = await this.prisma.db.organizationMember.findMany({
        where: {
          organizationId,
          isActive: true,
          ...(excludeSystemUser && {
            userId: {
              not: 'system',
            },
          }),
        },
        include: {
          user: true,
        },
      });

      return members.map((member) => ({
        id: member.id as OrganizationMemberId,
        userId: member.userId,
        organizationId: member.organizationId,
        role: member.role,
        isActive: member.isActive,
        invitedAt: member.invitedAt?.toISOString() || null,
        joinedAt: member.joinedAt?.toISOString() || null,
        createdAt: member.createdAt.toISOString(),
        user: {
          id: member.user.id,
          email: member.user.email,
          name: member.user.name,
          isActive: member.user.isActive,
          lastLoginAt: member.user.lastLoginAt?.toISOString() || null,
          createdAt: member.user.createdAt.toISOString(),
          updatedAt: member.user.updatedAt.toISOString(),
          currentOrganizationId: null as OrganizationId | null, // Not relevant in this context
        },
      })) as OrganizationMemberResponseDto[];
    } catch (error) {
      this.logger.error('[getOrganizationMembers] error fetching members', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        organizationId,
        userId,
      });
      throw error;
    }
  }

  async inviteToOrganization(
    organizationId: OrganizationId,
    data: InviteToOrganizationDto,
    userId: UserId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<OrganizationMemberResponseDto> {
    try {
      // Verify user has admin or owner role
      this.logger.debug('[inviteToOrganization] verifying user role', {
        organizationId,
        userId,
        email: data.email,
        projectsCount: data.projects?.length ?? 0,
      });
      const inviterRole = await this.projectAccess.assertOrganizationRole(
        organizationId,
        userId,
        'inviteToOrganization',
      );
      this.assertRoleGrantAllowed(inviterRole, data.role);

      const projects = data.projects ?? [];
      await this.assertCanAddToProjects(
        userId,
        projects.map((project) => project.projectId),
      );

      // Wrap user-creation + membership + project fan-out + welcome email in
      // a single transaction so any failure (including the email send) rolls
      // every write back. The email is sent inside the tx specifically so a
      // delivery failure surfaces as a 500 to the caller instead of leaving
      // an orphan invite the caller can never retry.
      const membership = await this.prisma.db.$transaction(async (tx) => {
        this.logger.debug('[inviteToOrganization] checking if user exists', {
          email: data.email,
        });
        const existingUser = await tx.user.findUnique({
          where: { email: data.email },
        });

        let inviteUserId: string;
        let createdUser: {
          name: string;
          passwordChangeCredential: string;
        } | null = null;

        if (!existingUser) {
          this.logger.debug(
            '[inviteToOrganization] no existing user, creating invited user',
            { email: data.email },
          );
          const { user, passwordChangeCredential } =
            await this.userService.createInvitedUser(
              tx,
              { email: data.email },
              requestMetadata,
            );
          inviteUserId = user.id;
          createdUser = { name: user.name, passwordChangeCredential };
        } else {
          this.logger.debug(
            '[inviteToOrganization] checking existing membership',
            {
              userId: existingUser.id,
              organizationId,
            },
          );
          const existingMembership = await tx.organizationMember.findUnique({
            where: {
              userId_organizationId: {
                userId: existingUser.id,
                organizationId,
              },
            },
          });

          if (existingMembership) {
            throw new BadRequestException('Unable to process invitation');
          }
          inviteUserId = existingUser.id;
        }

        this.logger.debug('[inviteToOrganization] creating membership', {
          userId: inviteUserId,
          organizationId,
          role: data.role,
        });
        const created = await tx.organizationMember.create({
          data: {
            userId: inviteUserId,
            organizationId,
            role: data.role,
            isActive: true,
            invitedAt: new Date(),
            joinedAt: new Date(), // Auto-join for now
          },
          include: {
            user: true,
          },
        });

        for (const assignment of projects) {
          this.logger.debug('[inviteToOrganization] assigning project', {
            userId: inviteUserId,
            organizationId,
            projectId: assignment.projectId,
            role: assignment.role,
          });
          await this.projectService.createProjectMembership(
            organizationId,
            assignment.projectId,
            { userId: inviteUserId as UserId, role: assignment.role },
            tx,
          );
        }

        if (createdUser) {
          this.logger.debug(
            '[inviteToOrganization] sending welcome email to new user',
            { email: data.email },
          );
          await this.emailService.sendWelcomeEmail({
            to: data.email,
            name: createdUser.name,
            passwordChangeCredential: createdUser.passwordChangeCredential,
          });
        }

        return created;
      });

      return {
        id: membership.id as OrganizationMemberId,
        userId: membership.userId,
        organizationId: membership.organizationId,
        role: membership.role,
        isActive: membership.isActive,
        invitedAt: membership.invitedAt?.toISOString() || null,
        joinedAt: membership.joinedAt?.toISOString() || null,
        createdAt: membership.createdAt.toISOString(),
        user: {
          id: membership.user.id,
          email: membership.user.email,
          name: membership.user.name,
          isActive: membership.user.isActive,
          lastLoginAt: membership.user.lastLoginAt?.toISOString() || null,
          createdAt: membership.user.createdAt.toISOString(),
          updatedAt: membership.user.updatedAt.toISOString(),
          currentOrganizationId: null,
        },
      };
    } catch (error) {
      this.logger.error('[inviteToOrganization] error inviting user', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        organizationId,
        userId,
        email: data.email,
      });
      throw error;
    }
  }

  async bulkInviteToOrganization(
    organizationId: OrganizationId,
    data: BulkInviteToOrganizationDto,
    userId: UserId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<BulkInviteResponse> {
    const startTime = Date.now();

    // Type assertion for generated types with @ts-nocheck
    const invitations = data.invitations;

    // Security: Log bulk invite attempt with correlation ID
    const correlationId = this.securityLogger.logBulkInviteAttempt(
      userId,
      organizationId,
      {
        batchSize: invitations.length,
        uniqueEmails: [...new Set(invitations.map((inv) => inv.email))].length,
        requestedRoles: [...new Set(invitations.map((inv) => inv.role))],
        inviterRole: OrganizationRole.MEMBER, // Will be updated after role verification
        successfulInvites: 0,
        failedInvites: 0,
        processingTimeMs: 0,
      },
    );

    // Verify user has admin or owner role
    const inviterRole = await this.projectAccess.assertOrganizationRole(
      organizationId,
      userId,
      'inviteToOrganization',
    );
    await this.assertCanAddToProjects(
      userId,
      invitations.flatMap((invitation) =>
        (invitation.projects ?? []).map((project) => project.projectId),
      ),
    );

    // Security: Enforce strict batch size limit to prevent memory exhaustion
    if (data.invitations.length > 25) {
      this.securityLogger.logExcessiveBatchAttempt(
        userId,
        organizationId,
        data.invitations.length,
        25,
      );
      throw new BadRequestException('Maximum 25 invitations allowed per batch');
    }

    // Security: Enhanced multi-layer email validation
    const emailValidation = validateEmailsBatch(
      data.invitations.map((inv) => inv.email),
    );

    // Check for batch-level anomalies
    const batchAnomalies = detectBatchAnomalies(emailValidation.results);
    if (batchAnomalies.hasAnomalies) {
      this.securityLogger.logSecurityEvent({
        eventType: 'BATCH_ANOMALY_DETECTED',
        userId,
        organizationId,
        severity: batchAnomalies.riskScore > 50 ? 'HIGH' : 'MEDIUM',
        metadata: {
          riskScore: batchAnomalies.riskScore,
          anomalies: batchAnomalies.anomalies,
          batchSize: data.invitations.length,
        },
      });
    }

    // Process validation results and update invitations
    const invalidResults = emailValidation.results.filter(
      (result) => !result.isValid,
    );
    if (invalidResults.length > 0) {
      this.securityLogger.logInvalidEmailAttempt(
        userId,
        organizationId,
        invalidResults.length,
        data.invitations.length,
      );
      throw new BadRequestException(
        'Unable to process one or more invitations',
      );
    }

    // Check for high-risk emails
    const highRiskEmails = emailValidation.results.filter(
      (result) => result.riskLevel === 'HIGH',
    );
    if (highRiskEmails.length > 0) {
      this.securityLogger.logSecurityEvent({
        eventType: 'HIGH_RISK_EMAIL_ATTEMPT',
        userId,
        organizationId,
        severity: 'HIGH',
        metadata: {
          highRiskCount: highRiskEmails.length,
          totalEmails: data.invitations.length,
          riskFlags: highRiskEmails.flatMap((result) => result.flags),
        },
      });
      throw new BadRequestException(
        'Unable to process one or more invitations',
      );
    }

    // Update invitations with sanitized emails
    data.invitations.forEach((inv, index) => {
      const validationResult = emailValidation.results[index];
      if (validationResult?.sanitizedEmail) {
        inv.email = validationResult.sanitizedEmail;
      }
    });

    // Log medium-risk emails for monitoring
    const mediumRiskEmails = emailValidation.results.filter(
      (result) => result.riskLevel === 'MEDIUM',
    );
    if (mediumRiskEmails.length > 0) {
      this.securityLogger.logSecurityEvent({
        eventType: 'MEDIUM_RISK_EMAIL_DETECTED',
        userId,
        organizationId,
        severity: 'MEDIUM',
        metadata: {
          mediumRiskCount: mediumRiskEmails.length,
          totalEmails: data.invitations.length,
          riskFlags: mediumRiskEmails.flatMap((result) => result.flags),
        },
      });
    }

    // Security: Validate role assignments to prevent privilege escalation
    const invalidRoleAssignment = data.invitations.some((inv) => {
      if (inviterRole === OrganizationRole.ADMIN) {
        // Admins cannot create owners or other admins
        const isEscalation =
          inv.role === OrganizationRole.OWNER ||
          inv.role === OrganizationRole.ADMIN;
        if (isEscalation) {
          this.securityLogger.logRoleEscalationAttempt(
            userId,
            organizationId,
            inv.role,
            inviterRole,
          );
        }
        return isEscalation;
      }
      return false; // Owners can assign any role
    });

    if (invalidRoleAssignment) {
      this.securityLogger.logBulkInviteFailure(
        userId,
        organizationId,
        'ROLE_ESCALATION_DENIED',
        {
          batchSize: data.invitations.length,
          inviterRole,
          processingTimeMs: Date.now() - startTime,
        },
      );
      throw new BadRequestException(
        'Insufficient permissions for requested role assignments',
      );
    }

    // Extract unique emails for logging/metrics.
    const emails = [...new Set(data.invitations.map((inv) => inv.email))];

    // Track emails already successfully processed in this batch so a
    // duplicate row in the same request resolves to the same user exactly
    // once (second occurrence fails with the generic error).
    const successfullyProcessedEmails = new Set<string>();

    const results: BulkInviteResult[] = [];

    for (const invitation of data.invitations) {
      if (successfullyProcessedEmails.has(invitation.email)) {
        results.push({
          email: invitation.email,
          success: false,
          member: undefined,
          error: 'Unable to process invitation',
        });
        continue;
      }

      try {
        const memberDto = await this.prisma.db.$transaction(
          async (tx) => {
            const existingUser = await tx.user.findUnique({
              where: { email: invitation.email },
            });

            let userId: string;
            let createdUserForThisRow: {
              name: string;
              passwordChangeCredential: string;
            } | null = null;

            if (!existingUser) {
              this.logger.debug(
                '[bulkInviteToOrganization] no existing user, creating invited user',
                { email: invitation.email },
              );
              const { user: createdUser, passwordChangeCredential } =
                await this.userService.createInvitedUser(
                  tx,
                  { email: invitation.email },
                  requestMetadata,
                );
              userId = createdUser.id;
              createdUserForThisRow = {
                name: createdUser.name,
                passwordChangeCredential,
              };
            } else {
              const existingMembership = await tx.organizationMember.findUnique(
                {
                  where: {
                    userId_organizationId: {
                      userId: existingUser.id,
                      organizationId,
                    },
                  },
                },
              );
              // Match single-invite semantics: any existing membership row
              // (active OR soft-deactivated) is rejected. Otherwise the
              // subsequent create would hit the unique constraint on
              // userId_organizationId and surface as an opaque DB error.
              if (existingMembership) {
                throw new BadRequestException('Unable to process invitation');
              }
              userId = existingUser.id;
            }

            const membership = await tx.organizationMember.create({
              data: {
                userId,
                organizationId,
                role: invitation.role,
                isActive: true,
                invitedAt: new Date(),
                joinedAt: new Date(), // TODO: Replace with proper invitation system
              },
              include: {
                user: true,
              },
            });

            for (const assignment of invitation.projects ?? []) {
              this.logger.debug(
                '[bulkInviteToOrganization] assigning project',
                {
                  userId,
                  organizationId,
                  projectId: assignment.projectId,
                  role: assignment.role,
                },
              );
              await this.projectService.createProjectMembership(
                organizationId,
                assignment.projectId,
                {
                  userId: userId as UserId,
                  role: assignment.role,
                },
                tx,
              );
            }

            if (createdUserForThisRow) {
              this.logger.debug(
                '[bulkInviteToOrganization] sending welcome email to new user',
                { email: invitation.email },
              );
              await this.emailService.sendWelcomeEmail({
                to: invitation.email,
                name: createdUserForThisRow.name,
                passwordChangeCredential:
                  createdUserForThisRow.passwordChangeCredential,
              });
            }

            const dto: OrganizationMemberResponseDto = {
              id: membership.id as OrganizationMemberId,
              userId: membership.userId,
              organizationId: membership.organizationId,
              role: membership.role,
              isActive: membership.isActive,
              invitedAt: membership.invitedAt?.toISOString() || null,
              joinedAt: membership.joinedAt?.toISOString() || null,
              createdAt: membership.createdAt.toISOString(),
              user: {
                id: membership.user.id,
                email: membership.user.email,
                name: membership.user.name,
                isActive: membership.user.isActive,
                lastLoginAt: membership.user.lastLoginAt?.toISOString() || null,
                createdAt: membership.user.createdAt.toISOString(),
                updatedAt: membership.user.updatedAt.toISOString(),
                currentOrganizationId: null,
              },
            };
            return dto;
          },
          {
            timeout: 30000,
            isolationLevel: 'ReadCommitted',
          },
        );

        results.push({
          email: invitation.email,
          success: true,
          member: memberDto,
          error: null,
        });
        successfullyProcessedEmails.add(invitation.email);
      } catch (rowError) {
        this.logger.debug('[bulkInviteToOrganization] row failed', {
          email: invitation.email,
          error: (rowError as Error).message,
        });
        // Rollback has already dropped the welcome-email entry for this row
        // (we only push to the queue at the end of a successful callback).
        results.push({
          email: invitation.email,
          success: false,
          member: undefined,
          error: 'Unable to process invitation',
        });
      }
    }

    // Calculate totals
    const totalSuccessful = results.filter((r) => r.success).length;
    const totalFailed = results.length - totalSuccessful;
    const processingTimeMs = Date.now() - startTime;

    // Security: Log successful completion with metrics
    this.securityLogger.logBulkInviteSuccess(
      userId,
      organizationId,
      {
        batchSize: data.invitations.length,
        uniqueEmails: emails.length,
        requestedRoles: [...new Set(data.invitations.map((inv) => inv.role))],
        inviterRole,
        successfulInvites: totalSuccessful,
        failedInvites: totalFailed,
        processingTimeMs,
      },
      correlationId,
    );

    // Security: Log individual successful invitations
    results
      .filter((r) => r.success)
      .forEach((result) => {
        const invitation = data.invitations.find(
          (inv) => inv.email === result.email,
        );
        if (invitation) {
          this.securityLogger.logMemberInvited(
            userId,
            organizationId,
            result.email,
            invitation.role,
          );
        }
      });

    return {
      totalRequested: data.invitations.length,
      totalSuccessful,
      totalFailed,
      results,
    };
  }

  /**
   * Soft-delete: marks an organization member as inactive and clears all of
   * their project memberships within the organization. The User record is
   * untouched — they may still belong to other organizations.
   *
   * Blocks removal of the last active OWNER of the organization.
   */
  async removeOrganizationMember(
    organizationId: OrganizationId,
    userId: UserId,
    actorUserId: UserId,
  ): Promise<void> {
    await this.projectAccess.assertOrganizationRole(
      organizationId,
      actorUserId,
      'removeOrganizationMember',
    );
    this.logger.debug('[removeOrganizationMember] removing org member', {
      organizationId,
      userId,
      actorUserId,
    });

    const membership = await this.prisma.db.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership || !membership.isActive) {
      this.logger.warn(
        '[removeOrganizationMember] membership not found or already inactive',
        { organizationId, userId },
      );
      throw new NotFoundException(
        `User ${userId} is not an active member of organization ${organizationId}`,
      );
    }

    if (membership.role === OrganizationRole.OWNER) {
      const remainingOwners = await this.prisma.db.organizationMember.count({
        where: {
          organizationId,
          role: OrganizationRole.OWNER,
          isActive: true,
          userId: { not: userId },
        },
      });
      if (remainingOwners === 0) {
        this.logger.warn(
          '[removeOrganizationMember] cannot remove last owner of organization',
          { organizationId, userId },
        );
        throw new BadRequestException(
          'Cannot remove the last owner of an organization',
        );
      }
    }

    await this.prisma.db.$transaction([
      this.prisma.db.organizationMember.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { isActive: false },
      }),
      this.prisma.db.projectMember.deleteMany({
        where: { userId, project: { organizationId } },
      }),
    ]);

    await this.membershipRevocation.membershipRemoved(userId);

    this.logger.log('[removeOrganizationMember] member removed from org', {
      organizationId,
      userId,
      membershipId: membership.id,
    });
  }

  /**
   * Soft-delete: marks the organization and all its members as inactive.
   * Data is preserved for potential restoration.
   */
  async deactivateOrganization(organizationId: OrganizationId): Promise<void> {
    this.logger.log(
      `[deactivateOrganization] soft-deleting organization ${organizationId}`,
    );

    const org = await this.prisma.db.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    await this.prisma.db.$transaction([
      this.prisma.db.organization.update({
        where: { id: organizationId },
        data: { isActive: false },
      }),
      this.prisma.db.organizationMember.updateMany({
        where: { organizationId },
        data: { isActive: false },
      }),
    ]);

    await this.membershipRevocation.membershipRemoved();

    this.logger.log(
      `[deactivateOrganization] organization ${organizationId} deactivated`,
    );
  }

  /**
   * Hard-delete: permanently removes the organization and all associated data.
   * Uses explicit deletion ordering to handle intermediate RESTRICT FK
   * constraints between org-owned tables, then deletes the org row
   * (CASCADE handles direct org-FK children).
   *
   * Intended for purging test/beta data only.
   */
  async purgeOrganization(organizationId: OrganizationId): Promise<void> {
    this.logger.warn(
      `[purgeOrganization] HARD-DELETING organization ${organizationId}`,
    );

    const org = await this.prisma.db.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    await this.prisma.db.$transaction(
      async (tx) => {
        // 1. Remove rows in tables WITHOUT an organization_id column that
        //    reference org-owned tables via RESTRICT FKs.
        await tx.$executeRaw`
          DELETE FROM messages
          WHERE conversation_id IN (
            SELECT id FROM conversations WHERE organization_id = ${organizationId}
          )`;
        await tx.$executeRaw`
          DELETE FROM project_initiatives
          WHERE project_id IN (
            SELECT id FROM projects WHERE organization_id = ${organizationId}
          )`;
        await tx.$executeRaw`
          DELETE FROM artifact_relations
          WHERE source_id IN (
            SELECT id FROM artifacts WHERE organization_id = ${organizationId}
          )
          OR target_id IN (
            SELECT id FROM artifacts WHERE organization_id = ${organizationId}
          )`;

        // 2. Remove org-owned tables that cross-reference other org-owned
        //    tables with RESTRICT (ordering prevents FK violations).
        //    tasks -> initiatives (RESTRICT)
        await tx.$executeRaw`
          DELETE FROM tasks WHERE organization_id = ${organizationId}`;
        //    integrations -> projects (RESTRICT)
        await tx.$executeRaw`
          DELETE FROM integrations WHERE organization_id = ${organizationId}`;
        //    flow_executions -> projects (RESTRICT)
        await tx.$executeRaw`
          DELETE FROM flow_executions WHERE organization_id = ${organizationId}`;
        //    unified_search_logs -> projects (RESTRICT)
        await tx.$executeRaw`
          DELETE FROM unified_search_logs WHERE organization_id = ${organizationId}`;
        //    initiatives -> projects (RESTRICT via originating_project_id)
        await tx.$executeRaw`
          DELETE FROM initiatives WHERE organization_id = ${organizationId}`;
        // 3. Delete the organization row.
        //    CASCADE handles all remaining direct children (conversations,
        //    projects, artifacts, services, members, api_keys, etc.).
        await tx.$executeRaw`
          DELETE FROM organizations WHERE id = ${organizationId}`;
      },
      { timeout: 60_000 },
    );

    this.logger.warn(
      `[purgeOrganization] organization ${organizationId} permanently deleted`,
    );
  }

  /** An ADMIN cannot hand out the roles that would let them outrank themselves. */
  private assertRoleGrantAllowed(
    inviterRole: OrganizationRole,
    requestedRole: OrganizationRole,
  ): void {
    if (
      inviterRole === OrganizationRole.ADMIN &&
      (requestedRole === OrganizationRole.OWNER ||
        requestedRole === OrganizationRole.ADMIN)
    ) {
      throw new BadRequestException(
        'Insufficient permissions for requested role assignments',
      );
    }
  }

  private async assertCanAddToProjects(
    actorUserId: UserId,
    projectIds: readonly string[],
  ): Promise<void> {
    for (const projectId of new Set(projectIds)) {
      await this.projectAccess.assertProjectRole(
        projectId,
        actorUserId,
        'addProjectMember',
      );
    }
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .substring(0, 50);
  }
}
