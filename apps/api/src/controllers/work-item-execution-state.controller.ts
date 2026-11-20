import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkItemExecutionStateBatchResponseDto } from '@hey-hey/contracts/api/models';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { CurrentOrganization } from 'src/auth/decorators/current-user.decorator';
import { OrganizationId, ProjectId } from 'src/types';
import { parseWorkItemExecutionStateBatchRequest } from 'src/services/work-item-execution-state/work-item-execution-state.boundary';
import { WorkItemExecutionStateService } from 'src/services/work-item-execution-state/work-item-execution-state.service';

@ApiTags('Tasks')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/work-items',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class WorkItemExecutionStateController {
  private readonly logger = new Logger(WorkItemExecutionStateController.name);

  constructor(
    private readonly executionStateService: WorkItemExecutionStateService,
  ) {}

  @Post('execution-state\\:batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read current execution state for work items' })
  async batchReadExecutionState(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() body: unknown,
  ): Promise<WorkItemExecutionStateBatchResponseDto> {
    const request = parseWorkItemExecutionStateBatchRequest(body);
    if (!request.valid) {
      this.logger.warn('[execution-state] batch read rejected', {
        code: 'MALFORMED',
        organizationId,
        projectId,
        failures: request.failures,
      });
      throw new BadRequestException(
        'workItemIds must contain 1 to 100 unique UUID values',
      );
    }

    const items = await this.executionStateService.readForProject(
      organizationId,
      projectId,
      request.value.workItemIds,
    );

    return { items } satisfies WorkItemExecutionStateBatchResponseDto;
  }
}
