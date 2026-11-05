import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthToken,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AdminHintListingService } from '../services/hints/admin-hint-listing.service';
import type { AdminProjectHintsResponse } from '@hey-hey/contracts/api/models';
import type { OrganizationId, ProjectId } from '../types';

@ApiTags('DebugAdmin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller(
  'api/v1/admin/organizations/:organizationId/projects/:projectId/hints',
)
export class AdminHintController {
  constructor(private readonly listing: AdminHintListingService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: string,
    @AuthToken() token: string,
    @Query('search') search?: string,
    @Query('itemTypes') itemTypes?: string | string[],
    @Query('minStrength') minStrength?: string,
  ): Promise<AdminProjectHintsResponse> {
    return this.listing.list(
      { userId, organizationId, projectId, token },
      {
        search: search?.trim() || undefined,
        itemTypes: parseItemTypes(itemTypes),
        minStrength: parseMinStrength(minStrength),
      },
    );
  }
}

function parseItemTypes(raw: string | string[] | undefined) {
  const values = [raw ?? []].flat().filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

function parseMinStrength(raw: string | undefined) {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException('minStrength must be a non-negative number');
  }
  return value;
}
