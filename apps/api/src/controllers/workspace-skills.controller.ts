import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import { CliReadWorkspaceSkillsListRequest } from '../generated';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import { WorkspaceSkillsReadService } from '../services/workspace-skills-read.service';

@Controller('api/v1/organizations/:organizationId/projects/:projectId/machines')
@UseGuards(
  JwtAuthGuard,
  OrganizationGuard,
  ProjectAccessGuard,
  ControllerBindingOriginGuard,
)
export class WorkspaceSkillsController {
  constructor(private readonly skills: WorkspaceSkillsReadService) {}

  @Post(':machineId/skills')
  @HttpCode(200)
  read(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('machineId', ParseUUIDPipe) machineId: MachineId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() request: CliReadWorkspaceSkillsListRequest,
    @Req() httpRequest: Request,
  ) {
    return this.skills.read({
      projectId,
      machineId,
      organizationId,
      userId,
      request,
      controllerBindingSecret: readControllerBindingSecret(httpRequest),
    });
  }
}
