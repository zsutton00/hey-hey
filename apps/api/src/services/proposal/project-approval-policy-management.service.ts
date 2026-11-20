import { Injectable, Logger } from '@nestjs/common';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectApprovalPolicyService } from './project-approval-policy.service';
import { ProjectApprovalPolicyStore } from './project-approval-policy.store';
import { ProjectApprovalPolicyValidation } from './project-approval-policy.validation';

@Injectable()
export class ProjectApprovalPolicyManagementService {
  private readonly logger = new Logger(
    ProjectApprovalPolicyManagementService.name,
  );
  constructor(
    private readonly access: ProjectAccessService,
    private readonly policies: ProjectApprovalPolicyService,
    private readonly store: ProjectApprovalPolicyStore,
    private readonly validation: ProjectApprovalPolicyValidation,
  ) {}

  async read(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ) {
    await this.access.assertProject(userId, organizationId, projectId);
    return this.policies.snapshot(projectId);
  }

  async replace(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    body: unknown,
  ) {
    await this.authorize(organizationId, projectId, userId);
    const stored = await this.store.read(projectId);
    const document = this.validation.replacement(body, projectId, stored.rules);
    const saved = await this.store.write(
      projectId,
      document.expectedRevision,
      document.rules,
    );
    return this.policies.snapshotFromStored(projectId, saved);
  }

  async restore(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    body: unknown,
  ) {
    await this.authorize(organizationId, projectId, userId);
    const document = this.validation.restore(body);
    const saved = await this.store.write(
      projectId,
      document.expectedRevision,
      null,
    );
    return this.policies.snapshotFromStored(projectId, saved);
  }

  private async authorize(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ) {
    await this.access.assertProject(userId, organizationId, projectId);
    await this.access.assertProjectRole(
      projectId,
      userId,
      'manageApprovalPolicy',
    );
    this.logger.log('Project approval policy management authorized', {
      organizationId,
      projectId,
      userId,
    });
  }
}
