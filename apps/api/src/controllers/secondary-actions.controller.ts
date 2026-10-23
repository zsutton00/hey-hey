import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SecondaryActionConfig } from 'src/generated';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { CurrentOrganization } from 'src/auth/decorators/current-user.decorator';
import { OrganizationId } from 'src/types';
import { SecondaryActionsService } from '../services/secondary-actions/secondary-actions.service';

@ApiTags('SecondaryActions')
@Controller('api/v1/organizations/:organizationId/secondary-actions')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class SecondaryActionsController {
  constructor(
    private readonly secondaryActionsService: SecondaryActionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List available secondary actions' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'uiElement',
    required: false,
    type: String,
    description: 'Filter actions by UI element identifier.',
  })
  @ApiQuery({
    name: 'actionType',
    required: false,
    type: String,
    description: 'Filter actions by action type.',
  })
  async findAll(
    @CurrentOrganization() _organizationId: OrganizationId,
    @Query('uiElement') uiElement?: string,
    @Query('actionType') actionType?: string,
  ): Promise<SecondaryActionConfig[]> {
    return this.secondaryActionsService.getActions({
      uiElement,
      actionType,
    });
  }
}
