import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import type { OpenItemsTriageSession } from '../generated';
import { OpenItemsTriageSessionService } from '../services/open-items/open-items-triage-session.service';
import type { OrganizationId, ProjectId, UserId } from '../types';

/**
 * Creates a new Open Items triage session for the authenticated user on every
 * call; an earlier session is never returned. The user always comes from the
 * authenticated context; guards enforce organization and project access
 * before the handler runs.
 */
@ApiTags('OpenItems')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/open-items/triage-session',
)
export class OpenItemsTriageSessionController {
  private readonly logger = new Logger(OpenItemsTriageSessionController.name);

  constructor(private readonly triageSessions: OpenItemsTriageSessionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'resolveOpenItemsTriageSession' })
  async resolveOpenItemsTriageSession(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<OpenItemsTriageSession> {
    this.logger.debug(
      `resolveOpenItemsTriageSession: authorized user ${userId} for project ${projectId} in org ${organizationId}`,
    );
    return this.triageSessions.create({ organizationId, projectId, userId });
  }
}
