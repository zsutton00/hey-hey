import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  SubmitTaskMonitorCommandRequestDto,
  SubmitTaskMonitorCommandResponseDto,
} from '../generated';
import { TaskMonitorCommandService } from '../services/task-monitor-command.service';
import { OrganizationId, ProjectId, TaskId } from '../types';
import type { Request } from 'express';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/work-items/:monitorId/monitor-commands',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class TaskMonitorCommandController {
  constructor(
    private readonly taskMonitorCommandService: TaskMonitorCommandService,
  ) {}

  @Post()
  @UseGuards(ControllerBindingOriginGuard)
  @ApiOperation({ summary: 'Submit an explicit Task Monitor command' })
  submit(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('monitorId', ParseUUIDPipe) monitorId: TaskId,
    @Body() request: SubmitTaskMonitorCommandRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() httpRequest?: Request,
  ): Promise<SubmitTaskMonitorCommandResponseDto> {
    return this.taskMonitorCommandService.submit({
      organizationId,
      projectId,
      monitorId,
      userId: user.userId,
      controllerBindingSecret: readControllerBindingSecret(httpRequest),
      request,
    });
  }
}
