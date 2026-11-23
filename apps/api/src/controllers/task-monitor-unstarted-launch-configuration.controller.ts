import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto,
  TaskMonitorExecutionNodeLaunchConfiguration,
} from '@hey-hey/contracts/api/models';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { TaskMonitorUnstartedLaunchConfigurationService } from '../services/tasks/task-monitor-unstarted-launch-configuration.service';
import { OrganizationId, ProjectId, TaskId } from '../types';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/work-items/:monitorId/unstarted-launch-configuration',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class TaskMonitorUnstartedLaunchConfigurationController {
  constructor(
    private readonly service: TaskMonitorUnstartedLaunchConfigurationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Apply one launch configuration to every unstarted Task Monitor task',
  })
  apply(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('monitorId', ParseUUIDPipe) monitorId: TaskId,
    // Validated with the whole execution definition against the generated
    // contract schema when the section is written.
    @Body() launchConfiguration: TaskMonitorExecutionNodeLaunchConfiguration,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto> {
    return this.service.apply({
      organizationId,
      projectId,
      monitorId,
      userId: user.userId,
      launchConfiguration,
    });
  }
}
