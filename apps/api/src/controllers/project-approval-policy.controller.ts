import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import {
  ProjectAccessGuard,
  ProjectResourceId,
} from 'src/auth/guards/project-access.guard';
import type {
  ProjectApprovalPolicyResponse,
  ProjectApprovalPolicySnapshot,
} from 'src/generated';
import { PROJECT_CONTROLLER_PATH } from 'src/generated/api/path-constants';
import { ProjectApprovalPolicyManagementService } from 'src/services/proposal/project-approval-policy-management.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';

@ProjectResourceId('project')
@Controller(`api/v1/${PROJECT_CONTROLLER_PATH}/:projectId/approval-policy`)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class ProjectApprovalPolicyController {
  constructor(
    private readonly management: ProjectApprovalPolicyManagementService,
  ) {}

  @Get()
  async read(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<ProjectApprovalPolicyResponse> {
    return this.response(
      await this.management.read(organizationId, projectId, userId),
    );
  }

  @Put()
  async replace(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<ProjectApprovalPolicyResponse> {
    return this.response(
      await this.management.replace(organizationId, projectId, userId, body),
    );
  }

  @Post()
  @HttpCode(200)
  async restore(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<ProjectApprovalPolicyResponse> {
    return this.response(
      await this.management.restore(organizationId, projectId, userId, body),
    );
  }

  private response(
    data: ProjectApprovalPolicySnapshot,
  ): ProjectApprovalPolicyResponse {
    return {
      success: true,
      message: 'Project approval policy',
      data,
      timestamp: new Date().toISOString(),
      statusCode: 200,
    };
  }
}
