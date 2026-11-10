import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import {
  OrganizationProjectEntitlementDto,
  UpdateOrganizationProjectEntitlementDto,
} from '@hey-hey/contracts/api/models';
import { AnyTransactionClient, PrismaService } from '../prisma/prisma.service';
import { OrganizationId, UserId } from '../types';

export const DEFAULT_PROJECT_LIMIT = 2;
export const PROJECT_LIMIT_REACHED_CODE =
  'ORGANIZATION_PROJECT_LIMIT_REACHED' as const;

const projectLimitMessage = (limit: number): string =>
  `This organization has reached its project limit (${limit}). Ask an organization owner or admin to increase the limit.`;

@Injectable()
export class OrganizationProjectEntitlementService {
  constructor(protected readonly prisma: PrismaService) {}

  async resolve(
    organizationId: OrganizationId,
    tx: AnyTransactionClient = this.prisma.db,
    options: { lockForProjectCreation?: boolean } = {},
  ): Promise<OrganizationProjectEntitlementDto> {
    const { policy, usage } = await this.readAndRecordUsage(
      organizationId,
      tx,
      options,
    );

    const projectLimit = policy?.projectLimitOverride ?? DEFAULT_PROJECT_LIMIT;
    const canCreateProject = usage.projectCount < projectLimit;

    return {
      defaultProjectLimit: DEFAULT_PROJECT_LIMIT,
      projectLimitOverride: policy?.projectLimitOverride ?? null,
      projectLimit,
      usage,
      canCreateProject,
      creationUnavailableReason: canCreateProject
        ? null
        : projectLimitMessage(projectLimit),
    } satisfies OrganizationProjectEntitlementDto;
  }

  /** Locks (optionally), reads the stored policy and live counts, and records the usage snapshot. */
  protected async readAndRecordUsage(
    organizationId: OrganizationId,
    tx: AnyTransactionClient,
    options: { lockForProjectCreation?: boolean },
  ) {
    if (options.lockForProjectCreation) {
      await tx.$queryRaw`
        SELECT id
        FROM organizations
        WHERE id = ${organizationId}
        FOR UPDATE
      `;
    }

    const [policy, projectCount, workItemCount] = await Promise.all([
      tx.organizationProjectEntitlement.findUnique({
        where: { organizationId },
      }),
      tx.project.count({
        where: { organizationId, deletedAt: null },
      }),
      tx.task.count({
        where: { organizationId, archivedAt: null },
      }),
    ]);
    const observedAt = new Date();

    await tx.organizationCapacityUsage.upsert({
      where: { organizationId },
      create: { organizationId, projectCount, workItemCount, observedAt },
      update: { projectCount, workItemCount, observedAt },
    });

    return {
      policy,
      usage: {
        projectCount,
        workItemCount,
        observedAt: observedAt.toISOString(),
      },
    };
  }

  async updateOverride(
    organizationId: OrganizationId,
    userId: UserId,
    update: UpdateOrganizationProjectEntitlementDto,
  ): Promise<OrganizationProjectEntitlementDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const membership = await tx.organizationMember.findUnique({
        where: {
          userId_organizationId: { userId, organizationId },
        },
        select: { isActive: true, role: true },
      });

      if (
        !membership?.isActive ||
        (membership.role !== OrganizationRole.OWNER &&
          membership.role !== OrganizationRole.ADMIN)
      ) {
        throw new ForbiddenException(
          'An active organization owner or admin membership is required to update the project limit.',
        );
      }

      await tx.organizationProjectEntitlement.upsert({
        where: { organizationId },
        create: {
          organizationId,
          projectLimitOverride: update.projectLimitOverride,
          updatedBy: userId,
        },
        update: {
          projectLimitOverride: update.projectLimitOverride,
          updatedBy: userId,
        },
      });

      return this.resolve(organizationId, tx);
    });
  }

  async assertProjectCreationAllowed(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
  ): Promise<void> {
    const entitlement = await this.resolve(organizationId, tx, {
      lockForProjectCreation: true,
    });

    if (!entitlement.canCreateProject) {
      throw new ConflictException({
        code: PROJECT_LIMIT_REACHED_CODE,
        message: entitlement.creationUnavailableReason,
        entitlement,
      });
    }
  }
}
