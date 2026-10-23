import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Controller,
  Delete,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
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
import { EntityType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { EntityStarDto } from '../generated';
import { EntityStarService } from '../services/entity-star/entity-star.service';
import { OrganizationId, UserId } from '../types';

@ApiTags('Stars')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/stars')
export class EntityStarController {
  constructor(private readonly entityStarService: EntityStarService) {}

  @Get()
  @ApiOperation({ summary: 'List starred entities for the current user' })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: EntityType,
    description: 'Filter starred entities by type',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of stars to return (max 100)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of stars to skip',
  })
  @ApiResponse({
    status: 200,
    description: 'List of starred entities',
  })
  async listStars(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Query('entityType') entityTypeParam?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ): Promise<EntityStarDto[]> {
    const entityType = this.parseEntityType(entityTypeParam);

    return this.entityStarService.listStars({
      organizationId,
      userId,
      entityType,
      limit,
      offset,
    });
  }

  @Put(':entityType/:entityId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Star an entity' })
  @ApiParam({
    name: 'entityType',
    enum: EntityType,
    description: 'Entity type to star',
  })
  @ApiParam({
    name: 'entityId',
    type: String,
    description: 'Entity identifier to star',
  })
  @ApiResponse({
    status: 200,
    description: 'Starred entity',
  })
  async createStar(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('entityType') entityTypeParam: string,
    @Param('entityId') entityId: string,
  ): Promise<EntityStarDto> {
    const entityType = this.parseEntityType(entityTypeParam);

    if (!entityType) {
      throw new BadRequestException('entityType is required');
    }

    return this.entityStarService.createOrGetStar({
      organizationId,
      userId,
      entityType,
      entityId,
    });
  }

  @Delete(':entityType/:entityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unstar an entity' })
  @ApiParam({
    name: 'entityType',
    enum: EntityType,
    description: 'Entity type to unstar',
  })
  @ApiParam({
    name: 'entityId',
    type: String,
    description: 'Entity identifier to unstar',
  })
  async removeStar(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('entityType') entityTypeParam: string,
    @Param('entityId') entityId: string,
  ): Promise<void> {
    const entityType = this.parseEntityType(entityTypeParam);

    if (!entityType) {
      throw new BadRequestException('entityType is required');
    }

    await this.entityStarService.removeStar({
      organizationId,
      userId,
      entityType,
      entityId,
    });
  }

  private parseEntityType(value?: string): EntityType | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.toUpperCase();
    const values = Object.values(EntityType);
    if (!values.includes(normalized as EntityType)) {
      throw new BadRequestException(`Unsupported entity type: ${value}`);
    }

    return normalized as EntityType;
  }
}
