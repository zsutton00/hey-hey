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
import type { LaunchEvalRunRequest, ReportDto } from 'src/generated';
import { EvalRunService } from 'src/services/eval-runs/eval-run.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';

@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/evals/:evalId/runs',
)
export class EvalRunController {
  constructor(private readonly evalRuns: EvalRunService) {}

  @Post()
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
