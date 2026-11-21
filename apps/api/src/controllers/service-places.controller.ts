import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import {
  ListMachineServicePlacesRequestDto,
  MAX_SERVICE_PLACE_SERVICE_IDS,
} from './dto/service-places-requests.dto';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import { ServicePlacesReadService } from '../services/service-places-read.service';
import { AgentSessionService } from '../services/agent-session.service';

const MAX_SERVICE_IDS = MAX_SERVICE_PLACE_SERVICE_IDS;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/v1/organizations/:organizationId/projects/:projectId')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class ServicePlacesController {
  constructor(
    private readonly places: ServicePlacesReadService,
    private readonly sessions: AgentSessionService,
  ) {}

  @Post('machines/:machineId/service-places')
  @UseGuards(ControllerBindingOriginGuard)
  @HttpCode(200)
  read(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('machineId', ParseUUIDPipe) machineId: MachineId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() request: ListMachineServicePlacesRequestDto,
    @Req() httpRequest: Request,
  ) {
    return this.places.read({
      projectId,
      machineId,
      organizationId,
      userId,
      request,
      controllerBindingSecret: readControllerBindingSecret(httpRequest),
    });
  }

  @Get('service-places/recent')
  listRecent(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceIds') serviceIdsQuery?: string | string[],
  ) {
    const serviceIds = [serviceIdsQuery ?? []].flat();

    // Validated as sent: the spec requires 1..20 unique UUIDs, so duplicates
    // are rejected rather than collapsed before the count check.
    if (
      serviceIds.length < 1 ||
      serviceIds.length > MAX_SERVICE_IDS ||
      new Set(serviceIds).size !== serviceIds.length ||
      !serviceIds.every((id) => UUID_PATTERN.test(id))
    ) {
      throw new BadRequestException(
        `serviceIds must list 1 to ${MAX_SERVICE_IDS} Service IDs`,
      );
    }

    return this.sessions.listRecentServicePlaces({
      organizationId,
      projectId,
      serviceIds,
    });
  }
}
