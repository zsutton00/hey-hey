import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  UserSettingsDailySessionReplacementRequestV1,
  UserSettingsResponse,
} from '../generated';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { CurrentOrganization, CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrganizationId, ProjectId, UserId } from '../types';
import { UserSettingsService } from '../services/user-settings.service';

@ApiTags('User Settings')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/user-settings/:settingsFamily',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class UserSettingsController {
  public constructor(private readonly userSettingsService: UserSettingsService) {}

  @Get()
  public async get(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('settingsFamily') settingsFamily: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<UserSettingsResponse> {
    return this.userSettingsService.get(organizationId, projectId, userId, settingsFamily);
  }

  @Put()
  public async replace(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('settingsFamily') settingsFamily: string,
    @Body() request: UserSettingsDailySessionReplacementRequestV1,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<UserSettingsResponse> {
    return this.userSettingsService.replace(
      organizationId,
      projectId,
      userId,
      settingsFamily,
      request,
    );
  }
}
