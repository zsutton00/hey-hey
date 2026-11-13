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
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { ProjectAccessGuard } from 'src/auth/guards/project-access.guard';
import type {
  EvalSessionStatusesRequest,
  EvalSessionStatus,
  LaunchEvalRunRequest,
  ReportDto,
} from '@hey-hey/contracts/api/models';
import { EvalRunService } from 'src/services/eval-runs/eval-run.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';

@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId')
export class EvalRunController {
  constructor(private readonly evalRuns: EvalRunService) {}

  @Post('eval-session-statuses')
  @HttpCode(HttpStatus.OK)
  statuses(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() request: EvalSessionStatusesRequest,
  ): Promise<EvalSessionStatus[]> {
    return this.evalRuns.sessionStatuses(organizationId, projectId, request);
  }

  @Post('evals/:evalId/runs')
  @HttpCode(HttpStatus.CREATED)
  launch(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('evalId', ParseUUIDPipe) evalId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() request: LaunchEvalRunRequest,
  ): Promise<ReportDto> {
    return this.evalRuns.launch(
      organizationId,
      projectId,
      userId,
      evalId,
      request,
    );
  }
}
