import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthToken,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { HintService } from '../services/hints/hint.service';
import type { ListProjectHintsResponse } from '../generated';
import type { OrganizationId, ProjectId } from '../types';

@ApiTags('DebugAdmin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller(
  'api/v1/admin/organizations/:organizationId/projects/:projectId/hints',
)
export class AdminHintController {
  constructor(private readonly hintService: HintService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: string,
    @AuthToken() token: string,
  ): Promise<ListProjectHintsResponse> {
    return this.hintService.listProjectHints({
      userId,
      organizationId,
      projectId,
      token,
    });
  }
}
