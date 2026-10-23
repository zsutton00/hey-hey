import { UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { EntityType, SummaryCategory } from '@prisma/client';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrganizationId, ProjectId } from '../types';
import { EntitySummaryService } from '../services/entity-summary/entity-summary.service';

class EmitSummaryUpdateDto {
  organizationId!: OrganizationId;
  projectId!: ProjectId;
  entityType!: EntityType;
  entityId!: string;
  summary!: string;
  category!: SummaryCategory;
  subfacets?: string[];
}

@ApiTags('Debug/Admin')
@UseGuards(AdminGuard)
@Controller('api/v1/debug/summary')
@SkipThrottle()
export class SummaryDebugController {
  constructor(private readonly entitySummaryService: EntitySummaryService) {}

  @Post('emit-update')
  @ApiOperation({
    summary:
      'Force emit a summary updated event by writing a new entity summary version',
  })
  async emitSummaryUpdate(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: EmitSummaryUpdateDto,
  ): Promise<{
    summaryId: string;
    version: number;
    subfacets: string[];
  }> {
    const organizationId =
      organizationIdFromParams ??
      body.organizationId ??
      user?.currentOrgId ??
      undefined;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (!body.entityType) {
      throw new BadRequestException('entityType is required');
    }
    if (!body.entityId) {
      throw new BadRequestException('entityId is required');
    }
    if (!body.summary) {
      throw new BadRequestException('summary is required');
    }
    if (!body.category) {
      throw new BadRequestException('category is required');
    }

    const subfacets = (body.subfacets || [])
      .map((s) => s.trim())
      .filter(Boolean);

    const { summary, subfacets: linkedSubfacets } =
      await this.entitySummaryService.createSummaryWithSubfacets({
        entityType: body.entityType,
        entityId: body.entityId,
        organizationId,
        projectId: body.projectId,
        summary: body.summary,
        category: body.category,
        subfacets,
      });

    return {
      summaryId: summary.id,
      version: summary.version,
      subfacets: linkedSubfacets.map((sf) => sf.name).filter(Boolean),
    };
  }
}
