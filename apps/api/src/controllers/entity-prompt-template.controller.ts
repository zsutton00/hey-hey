import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Post,
  HttpCode,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { CurrentOrganization } from '../auth/decorators/current-user.decorator';
import type {
  EntityPromptTemplateCatalogDto,
  EntityPromptTemplateEffectiveDto,
} from '../generated';
import type { OrganizationId, ProjectId } from '../types';
import { entityPromptTemplateDraftValidationRequestSchema } from '../services/entity-prompt-template.contract';
import { EntityPromptTemplateService } from '../services/entity-prompt-template.service';

@ApiTags('Entity Prompt Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/entity-prompt-templates',
)
export class EntityPromptTemplateController {
  public constructor(
    private readonly entityPromptTemplateService: EntityPromptTemplateService,
  ) {}

  @Post(':templateKey/validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate unsaved entity prompt-template content' })
  public validateDraft(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('templateKey') templateKey: string,
    @Body() body: unknown,
  ) {
    const request =
      entityPromptTemplateDraftValidationRequestSchema.safeParse(body);
    if (!request.success) {
      throw new BadRequestException(
        'Invalid template draft validation request',
      );
    }
    return this.entityPromptTemplateService.validateDraft(
      organizationId,
      projectId,
      templateKey,
      request.data,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get the project entity prompt-template catalog',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Prompt-template catalog returned' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({
    status: 404,
    description: 'Organization or project not found',
  })
  public getProjectCatalog(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
  ): Promise<EntityPromptTemplateCatalogDto> {
    return this.entityPromptTemplateService.getProjectCatalog(
      organizationId,
      projectId,
    );
  }

  @Get(':templateKey/effective')
  @ApiOperation({
    summary: 'Get the effective entity prompt template',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID', format: 'uuid' })
  @ApiParam({
    name: 'templateKey',
    description: 'Supported entity prompt-template key',
  })
  @ApiResponse({
    status: 200,
    description: 'Effective prompt template returned',
  })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'No eligible template exists' })
  public getEffectiveTemplate(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('templateKey') templateKey: string,
  ): Promise<EntityPromptTemplateEffectiveDto> {
    return this.entityPromptTemplateService.getEffectiveTemplate(
      organizationId,
      projectId,
      templateKey,
    );
  }
}
