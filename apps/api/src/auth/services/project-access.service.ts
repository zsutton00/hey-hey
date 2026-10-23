import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { OrganizationRole, Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OrganizationCapability,
  ProjectCapability,
  organizationRolesAllowing,
  projectRolesAllowing,
} from '../role-permissions';

/** Current persistence, never token membership snapshots, owns project access. */
@Injectable()
export class ProjectAccessService {
  private readonly logger = new Logger(ProjectAccessService.name);
  constructor(private readonly prisma: PrismaService) {}

  projectWhere(
    userId: string,
    organizationId?: string,
  ): Prisma.ProjectWhereInput {
    return {
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
      members: { some: { userId } },
      organization: {
        isActive: true,
        members: { some: { userId, isActive: true } },
      },
    };
  }

  async assertOrganization(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const membership = await this.prisma.db.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
        isActive: true,
        organization: { isActive: true },
      },
      select: { id: true },
    });
    if (!membership) {
      this.logger.warn('Organization access denied', {
        userId,
        organizationId,
        reason: 'inactive_or_missing_membership',
      });
      throw new ForbiddenException('Access denied to this organization');
    }
  }

  async assertProject(
    userId: string,
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.db.project.findFirst({
      where: { ...this.projectWhere(userId, organizationId), id: projectId },
      select: { id: true },
    });
    if (!project) {
      this.logger.warn('Project access denied', {
        userId,
        organizationId,
        projectId,
        reason: 'inaccessible_project',
      });
      throw new ForbiddenException('Access denied to this project');
    }
  }

  async assertProjectRoles(
    userId: string,
    organizationId: string,
    projectId: string,
    roles: readonly ProjectRole[],
  ): Promise<void> {
    const project = await this.prisma.db.project.findFirst({
      where: {
        ...this.projectWhere(userId, organizationId),
        id: projectId,
        members: { some: { userId, role: { in: [...roles] } } },
      },
      select: { id: true },
    });
    if (!project) {
      this.logger.warn('Project role denied', {
        userId,
        organizationId,
        projectId,
        roles,
        reason: 'inaccessible_project_or_insufficient_role',
      });
      throw new ForbiddenException('Insufficient project role');
    }
  }

  async accessibleProjectIds(
    userId: string,
    organizationId: string,
  ): Promise<string[]> {
    await this.assertOrganization(userId, organizationId);
    const projects = await this.prisma.db.project.findMany({
      where: this.projectWhere(userId, organizationId),
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return projects.map((project) => project.id);
  }

  /** Resolves the caller's current project role, or null without project access. */
  async findProjectRole(
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    const project = await this.prisma.db.project.findFirst({
      where: { ...this.projectWhere(userId), id: projectId },
      select: {
        members: { where: { userId }, select: { role: true }, take: 1 },
      },
    });
    return project?.members[0]?.role ?? null;
  }

  async assertProjectRole(
    projectId: string,
    userId: string,
    capability: ProjectCapability,
  ): Promise<ProjectRole> {
    const role = await this.findProjectRole(projectId, userId);
    if (!role || !projectRolesAllowing(capability).includes(role)) {
      this.logger.warn('Project role denied', {
        userId,
        projectId,
        capability,
        role,
      });
      throw new ForbiddenException('Insufficient permissions');
    }
    return role;
  }

  async assertOrganizationRole(
    organizationId: string,
    userId: string,
    capability: OrganizationCapability,
  ): Promise<OrganizationRole> {
    const membership = await this.prisma.db.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
        isActive: true,
        organization: { isActive: true },
      },
      select: { role: true },
    });
    if (
      !membership ||
      !organizationRolesAllowing(capability).includes(membership.role)
    ) {
      this.logger.warn('Organization role denied', {
        userId,
        organizationId,
        capability,
        role: membership?.role ?? null,
      });
      throw new ForbiddenException('Insufficient permissions');
    }
    return membership.role;
  }
}
