import { ProjectRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProjectAccessService } from '../auth/services/project-access.service';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateServiceDto,
  ServiceAgentSessionRelation,
  ServiceDto,
  ServiceInitiativeRelation,
  ServiceLinkDto,
  ServiceTaskRelation,
  UpdateServiceDto,
} from 'src/generated';
import { CurrentOrganization } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ServiceService } from '../services/service/service.service';
import { OrganizationId, ProjectId } from '../types';

const SERVICE_LIFECYCLE_ROLES = [ProjectRole.OWNER, ProjectRole.ARCHITECT];

@Controller('api/v1/organizations/:organizationId/services')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@ApiTags('Services')
@ApiBearerAuth()
export class ServiceController {
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly serviceService: ServiceService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List services' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter services by status (ACTIVE, ARCHIVED, DEPRECATED)',
  })
  @ApiQuery({
    name: 'serviceType',
    required: false,
    description: 'Filter services by type (backend, ui, database, etc.)',
  })
  @ApiQuery({
    name: 'repositoryType',
    required: false,
    description: 'Filter services by repository type (github, gitlab, etc.)',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Filter by associated project ID',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    description:
      'Filter by one or more tags (comma separated when providing multiple)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of results per page',
    type: Number,
  })
  @ApiResponse({ status: 200, description: 'Services retrieved' })
  async findAll(
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('tags') tags?: string | string[],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('serviceType') serviceType?: string,
    @Query('repositoryType') repositoryType?: string,
  ): Promise<ServiceDto[]> {
    const parsedTags = this.normalizeTags(tags);
    const parsedPage = this.parseNumber(page);
    const parsedLimit = this.parseNumber(limit);

    return this.serviceService.findAll(organizationId, {
      accessibleProjectIds: await this.projectAccess.accessibleProjectIds(
        callerId,
        organizationId,
      ),
      status,
      projectId: projectId as ProjectId,
      tags: parsedTags,
      page: parsedPage,
      limit: parsedLimit,
      serviceType,
      repositoryType,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a service' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({ status: 201, description: 'Service created' })
  async create(
    @Body() createServiceDto: CreateServiceDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ServiceDto> {
    return this.serviceService.create({
      ...createServiceDto,
      organizationId,
      tags: createServiceDto.tags ?? [],
    });
  }

  @Get(':serviceId')
  @ApiOperation({ summary: 'Get a service' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  @ApiResponse({ status: 200, description: 'Service retrieved' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async findOne(
    @Param('serviceId') serviceId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ServiceDto> {
    const service = await this.serviceService.findOne(
      serviceId,
      organizationId,
    );

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  @Patch(':serviceId')
  @ApiOperation({ summary: 'Update a service' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  @ApiResponse({ status: 200, description: 'Service updated' })
  async update(
    @Param('serviceId') serviceId: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ServiceDto> {
    return this.serviceService.update(
      serviceId,
      {
        ...updateServiceDto,
        tags: updateServiceDto.tags ?? undefined,
      },
      organizationId,
    );
  }

  @Post(':serviceId/archive')
  @ApiOperation({ summary: 'Archive a service' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  @ApiResponse({ status: 200, description: 'Service archived' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('serviceId') serviceId: string,
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ServiceDto> {
    await this.assertLifecycleRole(callerId, organizationId, serviceId);
    return this.serviceService.archive(serviceId, organizationId);
  }

  @Delete(':serviceId')
  @ApiOperation({ summary: 'Delete an archived service' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  @ApiResponse({ status: 200, description: 'Service deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  @ApiResponse({ status: 409, description: 'Service is not archived' })
  async delete(
    @Param('serviceId') serviceId: string,
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    await this.assertLifecycleRole(callerId, organizationId, serviceId);
    await this.serviceService.delete(serviceId, organizationId);
  }

  @Get(':serviceId/links')
  @ApiOperation({ summary: 'List linked entities for a service' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  @ApiResponse({
    status: 200,
    description: 'Service links retrieved successfully',
  })
  async getLinks(
    @Param('serviceId') serviceId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<
    Array<
      | ServiceTaskRelation
      | ServiceInitiativeRelation
      | ServiceAgentSessionRelation
    >
  > {
    return this.serviceService.getLinks(serviceId, organizationId);
  }

  @Post(':serviceId/links')
  @ApiOperation({ summary: 'Create a service link' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  @ApiResponse({
    status: 201,
    description: 'Service link created successfully',
  })
  async createLink(
    @Param('serviceId') serviceId: string,
    @Body() link: ServiceLinkDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<
    | ServiceTaskRelation
    | ServiceInitiativeRelation
    | ServiceAgentSessionRelation
  > {
    return this.serviceService.createLink(serviceId, organizationId, link);
  }

  @Delete(':serviceId/links')
  @ApiOperation({ summary: 'Remove a service link' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  @ApiQuery({
    name: 'entityType',
    required: true,
    description: 'Entity type to unlink (task, initiative, agent-session)',
  })
  @ApiQuery({
    name: 'entityId',
    required: true,
    description: 'Entity ID to unlink from the service',
  })
  @ApiResponse({
    status: 200,
    description: 'Service link removed successfully',
  })
  async removeLink(
    @Param('serviceId') serviceId: string,
    @Query('entityType') entityType: string | undefined,
    @Query('entityId') entityId: string | undefined,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<
    | ServiceTaskRelation
    | ServiceInitiativeRelation
    | ServiceAgentSessionRelation
  > {
    if (!entityType || !entityId) {
      throw new BadRequestException('entityType and entityId are required');
    }

    const parsedEntityType = this.parseServiceLinkEntityType(entityType);

    return this.serviceService.removeLink(serviceId, organizationId, {
      entityType: parsedEntityType,
      entityId,
    });
  }

  /**
   * Helper methods for parsing query parameters
   */
  private parseServiceLinkEntityType(
    entityType: string,
  ): ServiceLinkDto.EntityTypeEnum {
    const normalized = entityType.trim().toLowerCase();
    switch (normalized) {
      case ServiceLinkDto.EntityTypeEnum.Task:
      case ServiceLinkDto.EntityTypeEnum.Initiative:
      case ServiceLinkDto.EntityTypeEnum.AgentSession:
        return normalized;
      default:
        throw new BadRequestException(
          'entityType must be one of: task, initiative, agent-session',
        );
    }
  }

  private async assertLifecycleRole(
    callerId: string,
    organizationId: OrganizationId,
    serviceId: string,
  ): Promise<void> {
    const projectId = await this.serviceService.findOwningProjectId(
      serviceId,
      organizationId,
    );
    if (!projectId) {
      throw new ForbiddenException(
        'Service has no owning project to authorize against',
      );
    }
    await this.projectAccess.assertProjectRoles(
      callerId,
      organizationId,
      projectId,
      SERVICE_LIFECYCLE_ROLES,
    );
  }

  private normalizeTags(tags?: string | string[]): string[] | undefined {
    if (!tags) return undefined;
    if (Array.isArray(tags)) return tags;
    return tags.split(',').map((tag) => tag.trim());
  }

  private parseNumber(value?: string): number | undefined {
    if (!value) return undefined;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  }
}
