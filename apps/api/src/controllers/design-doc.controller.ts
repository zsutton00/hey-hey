import { ProjectAccessService } from '../auth/services/project-access.service';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  BadRequestException,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
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
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import { OrganizationId, ProjectId } from '../types';
import { DesignDocService } from '../services/design-doc/design-doc.service';
import { ProposalService } from '../services/proposal/proposal.service';
import type { StampedCreateProposalDto } from '../services/proposal/proposal.types';
import { buildUserRequestorContext } from '../services/proposal/user-requestor-context';
import { explainFieldUpdate } from '../services/proposal/proposal-eli5';
import {
  CreateDesignDocDto,
  DesignDocLibraryNodeDto,
  DesignDocResponseDto,
  DesignDocTemplate,
  Influence,
  UpdateDesignDocDto,
  UpdateDesignDocResponseDto,
} from 'src/generated';
import { CreateDesignDocLinkDto } from 'src/generated/model/createDesignDocLinkDto';
import { DesignDocLinkResponseDto } from 'src/generated/model/designDocLinkResponseDto';

@Controller('api/v1/organizations/:organizationId/design-docs')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@ApiTags('Design Docs')
@ApiBearerAuth()
export class DesignDocController {
  private readonly logger = new Logger(DesignDocController.name);

  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly designDocService: DesignDocService,
    private readonly proposalService: ProposalService,
  ) {}

  @Get('library')
  @ApiOperation({ summary: 'List design doc library hierarchy' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'projectId',
    required: true,
    description: 'Project ID used to scope the library hierarchy',
  })
  @ApiResponse({ status: 200, description: 'Design doc library retrieved' })
  @ApiResponse({ status: 400, description: 'Missing or invalid project ID' })
  async getLibrary(
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('projectId') projectId?: string,
  ): Promise<DesignDocLibraryNodeDto[]> {
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    return this.designDocService.getLibraryForAdapter(
      organizationId,
      projectId as ProjectId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List design documents' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter design documents by workflow status',
  })
  @ApiQuery({
    name: 'template',
    required: false,
    enum: ['ADR', 'DECISION', 'BRAINSTORM', 'PLAN_DOCUMENT'],
    description: 'Filter design documents by template type',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Filter by associated project ID',
  })
  @ApiQuery({
    name: 'taskId',
    required: false,
    description: 'Filter design docs whose parent is the given task ID',
  })
  @ApiQuery({
    name: 'planId',
    required: false,
    description: 'Filter by linked plan ID',
  })
  @ApiQuery({
    name: 'designDocId',
    required: false,
    description: 'Filter design docs whose parent is the given design doc ID',
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
  @ApiQuery({
    name: 'includeSectionKeys',
    required: false,
    description:
      'When provided, include only the requested section keys in each design doc response.',
    isArray: true,
  })
  @ApiResponse({ status: 200, description: 'Design documents retrieved' })
  async findAll(
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('tags') tags?: string | string[],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('template') template?: DesignDocTemplate,
    @Query('includeSectionKeys') includeSectionKeys?: string | string[],
    @Query('taskId') taskId?: string,
    @Query('planId') planId?: string,
    @Query('designDocId') designDocId?: string,
  ): Promise<DesignDocResponseDto[]> {
    const parsedTags = this.normalizeTags(tags);
    const parsedPage = this.parseNumber(page);
    const parsedLimit = this.parseNumber(limit);
    const sectionKeys = this.normalizeSectionKeys(includeSectionKeys);

    return this.designDocService.findAllForAdapter(organizationId, {
      accessibleProjectIds: await this.projectAccess.accessibleProjectIds(
        callerId,
        organizationId,
      ),
      status,
      projectId: projectId as ProjectId,
      tags: parsedTags,
      page: parsedPage,
      limit: parsedLimit,
      template,
      taskId,
      planId,
      designDocId,
      ...(sectionKeys ? { includeSectionKeys: sectionKeys } : {}),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a design document' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({ status: 201, description: 'Design document created' })
  async create(
    @Body() createDesignDocDto: CreateDesignDocDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    return this.designDocService.createForAdapter(
      {
        ...createDesignDocDto,
        tags: createDesignDocDto.tags ?? [],
      },
      organizationId,
    );
  }

  @Get(':designDocId')
  @ApiOperation({ summary: 'Get a design document' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'designDocId', description: 'Design document ID' })
  @ApiResponse({ status: 200, description: 'Design document retrieved' })
  @ApiResponse({ status: 404, description: 'Design document not found' })
  async findOne(
    @Param('designDocId') designDocId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    const designDoc = await this.designDocService.findOneForAdapter(
      designDocId,
      organizationId,
    );

    if (!designDoc) {
      throw new NotFoundException('Design document not found');
    }

    return designDoc;
  }

  @Patch(':designDocId')
  @ApiOperation({ summary: 'Update a design document' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'designDocId', description: 'Design document ID' })
  @ApiResponse({
    status: 200,
    description:
      'Update accepted. Response carries `status: APPLIED` with the ' +
      'updated design doc when the change took effect, or `status: PENDING` ' +
      'with the unchanged design doc and a `proposal` payload otherwise.',
  })
  @ApiResponse({ status: 404, description: 'Design document not found' })
  async update(
    @Param('designDocId') designDocId: string,
    @Body() updateDesignDocDto: UpdateDesignDocDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<UpdateDesignDocResponseDto> {
    // `reason` is metadata about the edit, not part of the diff to enact.
    // Strip it at the controller boundary so it never lands in the proposal's
    // `updates` payload (which is replayed verbatim by enactUpdateDesignDoc).
    const { reason, ...updates } = updateDesignDocDto;

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'PATCH /design-docs/:designDocId requires at least one field to change.',
      );
    }

    // The design-doc route carries no projectId path param, so scope the
    // proposal to the doc's own project (also yields the existence/404 check).
    const existing = await this.designDocService.findOneForAdapter(
      designDocId,
      organizationId,
    );
    if (!existing) {
      throw new NotFoundException('Design document not found');
    }
    if (!existing.projectId) {
      throw new BadRequestException(
        'Design document is not associated with a project and cannot be edited.',
      );
    }
    const projectId = existing.projectId as ProjectId;

    const requestorContext = buildUserRequestorContext(
      user,
      organizationId,
      request,
      'PATCH /organizations/:organizationId/design-docs/:designDocId',
    );

    const userInfluence: Influence = {
      entityId: user.userId,
      entityType: 'USER',
      reasonType: 'user_reason',
      reasoning: (reason ?? '').trim(),
    };

    const dto: StampedCreateProposalDto = {
      type: 'SINGLE',
      action: 'UPDATE',
      eli5: explainFieldUpdate('design doc', Object.keys(updates)),
      targetEntityType: 'DESIGN_DOC',
      targetEntityId: designDocId,
      updates,
      requestorContext,
      influences: [userInfluence],
    };

    this.logger.log('Creating UPDATE proposal for design doc PATCH', {
      designDocId,
      organizationId,
      projectId,
      updateKeys: Object.keys(updates),
    });

    const proposal = await this.proposalService.create(
      organizationId,
      projectId,
      user.userId,
      dto,
    );

    // A PENDING proposal hasn't touched the doc, so `existing` is still current
    // and we skip a redundant read. Only an auto-approved UPDATE mutates it.
    if (proposal.status === 'APPROVED') {
      const designDoc = await this.designDocService.findOneForAdapter(
        designDocId,
        organizationId,
      );
      if (!designDoc) {
        throw new NotFoundException('Design document not found');
      }
      return { status: 'APPLIED', designDoc };
    }
    return { status: 'PENDING', designDoc: existing, proposal };
  }

  @Delete(':designDocId')
  @ApiOperation({ summary: 'Archive a design document' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'designDocId', description: 'Design document ID' })
  @ApiResponse({ status: 200, description: 'Design document archived' })
  async remove(
    @Param('designDocId') designDocId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    return this.designDocService.removeForAdapter(designDocId, organizationId);
  }

  @Patch(':designDocId/restore')
  @ApiOperation({ summary: 'Restore an archived design document' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'designDocId', description: 'Design document ID' })
  @ApiResponse({ status: 200, description: 'Design document restored' })
  async restore(
    @Param('designDocId') designDocId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    return this.designDocService.restoreForAdapter(designDocId, organizationId);
  }

  @Get(':designDocId/links')
  @ApiOperation({ summary: 'List linked entities for a design document' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'designDocId', description: 'Design document ID' })
  @ApiQuery({
    name: 'includeDetails',
    required: false,
    description:
      'When true, include entity name/title and status in the link responses',
    type: Boolean,
  })
  @ApiResponse({
    status: 200,
    description: 'Design document links retrieved successfully',
  })
  async getLinks(
    @Param('designDocId') designDocId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('includeDetails') includeDetails?: string,
  ): Promise<DesignDocLinkResponseDto[]> {
    const includeDetailsFlag = this.parseBoolean(includeDetails);
    return this.designDocService.getLinksForAdapter(
      designDocId,
      organizationId,
      includeDetailsFlag,
    );
  }

  @Post(':designDocId/links')
  @ApiOperation({ summary: 'Create design document links' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'designDocId', description: 'Design document ID' })
  @ApiResponse({
    status: 201,
    description: 'Design document links created successfully',
  })
  async createLinks(
    @Param('designDocId') designDocId: string,
    @Body() links: CreateDesignDocLinkDto | CreateDesignDocLinkDto[],
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<DesignDocLinkResponseDto[]> {
    return this.designDocService.createLinksForAdapter(
      designDocId,
      links,
      organizationId,
    );
  }

  @Delete(':designDocId/links/:linkId')
  @ApiOperation({ summary: 'Remove a design document link' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'designDocId', description: 'Design document ID' })
  @ApiParam({ name: 'linkId', description: 'Design document link ID' })
  @ApiResponse({
    status: 200,
    description: 'Design document link removed successfully',
  })
  async deleteLink(
    @Param('designDocId') designDocId: string,
    @Param('linkId') linkId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<DesignDocLinkResponseDto> {
    return this.designDocService.removeLinkForAdapter(
      designDocId,
      linkId,
      organizationId,
    );
  }

  private normalizeTags(tags?: string | string[]): string[] | undefined {
    if (!tags) {
      return undefined;
    }

    if (Array.isArray(tags)) {
      return tags
        .flatMap((tag) => tag.split(','))
        .map((tag) => tag.trim())
        .filter(Boolean);
    }

    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  private normalizeSectionKeys(
    includeSectionKeys?: string | string[],
  ): string[] | undefined {
    const keys = Array.isArray(includeSectionKeys)
      ? includeSectionKeys
      : typeof includeSectionKeys === 'string'
        ? includeSectionKeys.split(',')
        : [];
    const normalized = keys
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    return normalized.length > 0 ? normalized : undefined;
  }

  private parseBoolean(value?: string): boolean {
    if (!value) {
      return false;
    }

    const normalized = value.toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  private parseNumber(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
