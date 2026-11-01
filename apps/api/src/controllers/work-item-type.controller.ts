import { SessionRole } from '../generated/model/sessionRole';
import type { WorkItemTypeRoleGuidanceDto } from '../generated/model/workItemTypeRoleGuidanceDto';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request } from 'express';
import { WorkItemTypeLifecycleStatus } from '../generated/model/workItemTypeLifecycleStatus';
import type { WorkItemTypeDefinitionDto } from '../generated/model/workItemTypeDefinitionDto';
import type { WorkItemTypeCascadeImpactDto } from '../generated/model/workItemTypeCascadeImpactDto';
import type { WorkItemTypeCascadeImpactConflictDto } from '../generated/model/workItemTypeCascadeImpactConflictDto';
import type { WorkItemTypeArchiveRequestDto } from '../generated/model/workItemTypeArchiveRequestDto';
import type { WorkItemTypeEditRequestDto } from '../generated/model/workItemTypeEditRequestDto';
import type { WorkItemTypeSummaryDto } from '../generated/model/workItemTypeSummaryDto';
import { OrganizationId, ProjectId } from 'src/types';
import {
  AuthToken,
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProposalService } from '../services/proposal/proposal.service';
import type { TypedProposalResponse } from '../services/proposal/proposal.types';
import { buildUserRequestorContext } from '../services/proposal/user-requestor-context';
import { WorkItemTypeEffectiveSource } from '../generated/model/workItemTypeEffectiveSource';
import {
  buildWorkItemTypeArchiveProposal,
  buildWorkItemTypeCascadeDeleteProposal,
  buildWorkItemTypeCreateProposal,
  buildWorkItemTypeEditProposal,
  buildWorkItemTypeRestoreProposal,
  buildWorkItemTypeResetProposal,
} from '../services/proposal/work-item-type-proposal.builder';
import { assertWorkItemTypeEditSupported } from '../services/proposal/work-item-type-edit-classifier';
import { WorkItemTypeImpactService } from '../services/tasks/work-item-type-impact.service';
import { WorkItemTypeRegistryService } from '../services/tasks/work-item-type-registry.service';
import { ProjectService } from '../services/project.service';
import type { WorkItemTypeMaintenanceGuidanceDto } from '../generated/model/workItemTypeMaintenanceGuidanceDto';
import type { WorkItemTypeGuidanceBatchDto } from '../generated/model/workItemTypeGuidanceBatchDto';
import type { WorkItemTypeGuidanceBatchRequestDto as WorkItemTypeGuidanceBatchRequest } from '../generated/model/workItemTypeGuidanceBatchRequestDto';
import { WorkItemTypeGuidancePurpose } from '../generated/model/workItemTypeGuidancePurpose';

export class WorkItemTypeGuidanceQueryDto {
  @ApiProperty({ enum: WorkItemTypeGuidancePurpose })
  @IsEnum(WorkItemTypeGuidancePurpose)
  purpose!: WorkItemTypeGuidancePurpose;

  @ApiPropertyOptional({
    enum: SessionRole,
    description: 'Required for purpose role; no default.',
  })
  @ValidateIf(
    (request: WorkItemTypeGuidanceQueryDto) =>
      request.purpose === WorkItemTypeGuidancePurpose.Role ||
      request.sessionRole !== undefined,
  )
  @IsEnum(SessionRole)
  sessionRole?: SessionRole;
}

export class WorkItemTypeGuidanceBatchRequestDto
  implements WorkItemTypeGuidanceBatchRequest
{
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 10,
    description:
      'Distinct work-item type keys, returned in request order. Duplicate keys are invalid.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  typeKeys!: string[];

  @ApiProperty({ enum: WorkItemTypeGuidancePurpose })
  @IsEnum(WorkItemTypeGuidancePurpose)
  purpose!: WorkItemTypeGuidancePurpose;

  @ApiPropertyOptional({
    enum: SessionRole,
    description: 'Required for purpose role; no default.',
  })
  @ValidateIf(
    (request: WorkItemTypeGuidanceQueryDto) =>
      request.purpose === WorkItemTypeGuidancePurpose.Role ||
      request.sessionRole !== undefined,
  )
  @IsEnum(SessionRole)
  sessionRole?: SessionRole;
}

/** Optional lifecycle-status filter for the list endpoint. */
class ListWorkItemTypesQueryDto {
  @ApiPropertyOptional({ enum: WorkItemTypeLifecycleStatus })
  @IsOptional()
  @IsEnum(WorkItemTypeLifecycleStatus)
  status?: WorkItemTypeLifecycleStatus;
}

/**
 * OpenAPI uses `style: form, explode: true` for both impact routes, so the
 * generated clients send repeated query keys (for example
 * `removedSectionKeys=brief&removedSectionKeys=audience`). Express represents
 * one value as a string and repeated values as an array; normalize only that
 * transport distinction and leave the validated keys otherwise untouched.
 */
class SectionContentImpactQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  removedSectionKeys!: string[];
}

class TrackingLinkRevocationImpactQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  revokedTrackingSourceTypeKeys!: string[];
}

class WorkItemTypeRetirementQueryDto {
  @ApiPropertyOptional({
    description: 'Set true to request irreversible cascade deletion.',
    default: false,
  })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? value : value === true || value === 'true',
  )
  @IsOptional()
  @IsBoolean()
  cascade?: boolean;

  @ApiPropertyOptional({
    description: 'Caller-confirmed count of affected work items.',
    minimum: 0,
    type: Number,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  confirmedItemCount?: number;

  @ApiPropertyOptional({
    description: 'Caller-confirmed count of distinct incident graph edges.',
    minimum: 0,
    type: Number,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  confirmedEdgeCount?: number;
}

export class WorkItemTypeCascadeImpactConflictException extends ConflictException {
  constructor(currentImpact: WorkItemTypeCascadeImpactDto) {
    const response: WorkItemTypeCascadeImpactConflictDto = {
      success: false,
      message: 'The confirmed cascade impact is stale.',
      data: { currentImpact },
      timestamp: new Date().toISOString(),
      statusCode: HttpStatus.CONFLICT,
    };
    super(response);
  }
}

/**
 * Backs the admin form's `/work-item-types` surface. Reads serve the
 * project-scoped type definitions straight from the registry's in-process
 * snapshot; the mutation funnels the submitted definition through the same
 * WORK_ITEM_TYPE proposal the agentic `create_work_item_type` MCP tool builds.
 * New definitions use the nil-target CREATE envelope; a complete definition
 * submitted for a retained archived key uses a stable-key CREATE envelope so
 * the proposal pipeline can restore that row. Validation and
 * enactment of the resulting proposal are owned by the proposal pipeline;
 * this controller only assembles, submits, and reads.
 */
@ApiTags('Work Item Types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/work-item-types',
)
export class WorkItemTypeController {
  private readonly logger = new Logger(WorkItemTypeController.name);

  constructor(
    private readonly registry: WorkItemTypeRegistryService,
    private readonly proposalService: ProposalService,
    private readonly impactService: WorkItemTypeImpactService,
    private readonly projectService: ProjectService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List work-item types' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: WorkItemTypeLifecycleStatus,
  })
  findMany(
    @Param('projectId') projectId: ProjectId,
    @Query(ValidationPipe) query: ListWorkItemTypesQueryDto,
  ): WorkItemTypeSummaryDto[] {
    this.logger.log(
      `Listing work-item types for project ${projectId}` +
        `${query.status ? ` (status ${query.status})` : ''}`,
    );
    return this.registry.getDefinitions(projectId, query.status);
  }

  @Get(':typeKey')
  @ApiOperation({ summary: 'Get a work-item type by key' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'typeKey', description: 'Work-item type key' })
  @ApiResponse({ status: 404, description: 'Work-item type not found' })
  findOne(
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
  ): WorkItemTypeSummaryDto {
    this.logger.log(
      `Getting work-item type '${typeKey}' for project ${projectId}`,
    );
    const summary = this.registry.getDefinition(projectId, typeKey);
    if (!summary) {
      throw new NotFoundException(
        `Work-item type '${typeKey}' is not available in this project.`,
      );
    }
    return summary;
  }

  @Get(':typeKey/guidance')
  @ApiOperation({ summary: 'Read work-item type guidance by purpose' })
  @ApiQuery({
    name: 'sessionRole',
    required: false,
    enum: SessionRole,
    description: 'Required when purpose is role; no default.',
  })
  @ApiQuery({
    name: 'purpose',
    required: true,
    enum: WorkItemTypeGuidancePurpose,
  })
  @ApiResponse({
    status: 404,
    description: 'Project, type, or guidance unavailable',
  })
  async getGuidance(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: WorkItemTypeGuidanceQueryDto,
  ): Promise<WorkItemTypeMaintenanceGuidanceDto | WorkItemTypeRoleGuidanceDto> {
    if (!(await this.projectService.findOne(projectId, organizationId))) {
      throw new NotFoundException('Project not found or not accessible.');
    }
    return this.registry.getGuidance(
      projectId,
      typeKey,
      query.purpose,
      query.sessionRole,
    );
  }

  @Post('guidance/batch')
  @ApiOperation({ summary: 'Read work-item type guidance for a batch' })
  @ApiResponse({
    status: 200,
    description: 'Ordered purpose-scoped guidance for every requested type.',
  })
  @ApiResponse({
    status: 404,
    description: 'Project or requested type unavailable.',
  })
  async getGuidanceBatch(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    request: WorkItemTypeGuidanceBatchRequestDto,
  ): Promise<WorkItemTypeGuidanceBatchDto> {
    if (!(await this.projectService.findOne(projectId, organizationId))) {
      throw new NotFoundException('Project not found or not accessible.');
    }
    return this.registry.getGuidanceBatch(projectId, request);
  }

  @Post(':typeKey/reset')
  @HttpCode(HttpStatus.CREATED)
  async reset(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
    @Req() request: Request,
  ): Promise<TypedProposalResponse> {
    const row = this.registry.getDefinition(projectId, typeKey);
    if (!row)
      throw new NotFoundException(
        `Work-item type '${typeKey}' is not available in this project.`,
      );
    if (row.effectiveSource !== WorkItemTypeEffectiveSource.CanonicalOverride)
      throw new ForbiddenException(
        `Work-item type '${typeKey}' is not a canonical override.`,
      );
    return this.proposalService.create(
      organizationId,
      projectId,
      user.userId,
      buildWorkItemTypeResetProposal(
        typeKey,
        buildUserRequestorContext(
          user,
          organizationId,
          request,
          'POST /work-item-types/:typeKey/reset',
        ),
      ),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a work-item type definition' })
  @ApiResponse({ status: 201, description: 'Proposal created' })
  @ApiResponse({ status: 400, description: 'Definition failed validation' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body() definition: WorkItemTypeDefinitionDto,
    @Req() request: Request,
  ): Promise<TypedProposalResponse> {
    const requestorContext = buildUserRequestorContext(
      user,
      organizationId,
      request,
      'POST /work-item-types',
    );

    const retained = this.registry.getDefinition(projectId, definition.key);
    const dto =
      retained?.status === WorkItemTypeLifecycleStatus.Archived
        ? buildWorkItemTypeRestoreProposal({
            typeKey: definition.key,
            definition,
            requestorContext,
          })
        : buildWorkItemTypeCreateProposal({
            definition,
            requestorContext,
          });

    this.logger.log(
      `Submitting work-item type definition '${definition.key}' ` +
        `(${definition.name}) as a ${dto.action} WORK_ITEM_TYPE proposal for project ${projectId}`,
    );

    return this.proposalService.create(
      organizationId,
      projectId,
      user.userId,
      dto,
    );
  }

  @Patch(':typeKey')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a work-item type edit for review' })
  @ApiResponse({ status: 201, description: 'Proposal created' })
  @ApiResponse({ status: 404, description: 'Work-item type not found' })
  async edit(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
    @Body() requestBody: WorkItemTypeEditRequestDto,
    @Req() request: Request,
  ): Promise<TypedProposalResponse> {
    const row = this.assertActive(projectId, typeKey);
    if (
      row.effectiveSource === WorkItemTypeEffectiveSource.Canonical &&
      !requestBody.acknowledgeCanonicalCustomization
    ) {
      throw new BadRequestException(
        'Canonical customization acknowledgement is required.',
      );
    }
    assertWorkItemTypeEditSupported(row, requestBody.definition);
    const requestorContext = buildUserRequestorContext(
      user,
      organizationId,
      request,
      'PATCH /work-item-types/:typeKey',
    );
    const dto = buildWorkItemTypeEditProposal({
      typeKey,
      definition: requestBody.definition,
      acknowledgeCanonicalCustomization:
        requestBody.acknowledgeCanonicalCustomization,
      requestorContext,
    });
    return this.proposalService.create(
      organizationId,
      projectId,
      user.userId,
      dto,
    );
  }

  @Delete(':typeKey')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a work-item type retirement for review' })
  @ApiResponse({ status: 201, description: 'Proposal created' })
  @ApiResponse({ status: 404, description: 'Work-item type not found' })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
    @Body() requestBody: WorkItemTypeArchiveRequestDto = {},
    @Req() request: Request,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: WorkItemTypeRetirementQueryDto = {},
    @AuthToken() userToken: string | null = null,
  ): Promise<TypedProposalResponse> {
    const cascade = query.cascade === true;
    if (cascade) {
      this.assertArchivedCustom(projectId, typeKey);
    } else {
      const row = this.assertActive(projectId, typeKey);
      if (
        row.effectiveSource === WorkItemTypeEffectiveSource.Canonical &&
        !requestBody.acknowledgeCanonicalCustomization
      ) {
        throw new ForbiddenException(
          'Canonical customization acknowledgement is required.',
        );
      }
    }
    const requestorContext = buildUserRequestorContext(
      user,
      organizationId,
      request,
      'DELETE /work-item-types/:typeKey',
    );
    const dto = cascade
      ? await this.buildConfirmedCascadeProposal(
          organizationId,
          projectId,
          typeKey,
          query,
          userToken,
          requestorContext,
        )
      : buildWorkItemTypeArchiveProposal({
          typeKey,
          request: requestBody,
          requestorContext,
        });
    return this.proposalService.create(
      organizationId,
      projectId,
      user.userId,
      dto,
    );
  }

  private async buildConfirmedCascadeProposal(
    organizationId: OrganizationId,
    projectId: ProjectId,
    typeKey: string,
    query: WorkItemTypeRetirementQueryDto,
    userToken: string | null,
    requestorContext: ReturnType<typeof buildUserRequestorContext>,
  ) {
    if (
      query.confirmedItemCount === undefined ||
      query.confirmedEdgeCount === undefined
    ) {
      throw new BadRequestException(
        'confirmedItemCount and confirmedEdgeCount are required for cascade=true',
      );
    }

    const currentImpact = await this.impactService.countCascadeImpact(
      organizationId,
      projectId,
      typeKey,
      userToken,
    );
    if (
      query.confirmedItemCount !== currentImpact.itemCount ||
      query.confirmedEdgeCount !== currentImpact.edgeCount
    ) {
      throw new WorkItemTypeCascadeImpactConflictException(currentImpact);
    }

    return buildWorkItemTypeCascadeDeleteProposal({
      typeKey,
      itemCount: query.confirmedItemCount,
      edgeCount: query.confirmedEdgeCount,
      requestorContext,
    });
  }

  @Get(':typeKey/cascade-impact')
  @ApiOperation({ summary: 'Count cascade-delete impact' })
  @ApiResponse({
    status: 400,
    description: 'System work-item types cannot be cascade-deleted',
  })
  @ApiResponse({ status: 404, description: 'Work-item type not found' })
  async countCascadeImpact(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
    @AuthToken() userToken: string | null,
  ): Promise<WorkItemTypeCascadeImpactDto> {
    this.assertArchivedCustom(projectId, typeKey);
    return this.impactService.countCascadeImpact(
      organizationId,
      projectId,
      typeKey,
      userToken,
    );
  }

  @Get(':typeKey/section-content-impact')
  @ApiOperation({ summary: 'Count section removal impact' })
  @ApiQuery({
    name: 'removedSectionKeys',
    required: true,
    isArray: true,
    type: String,
  })
  @ApiResponse({ status: 404, description: 'Work-item type not found' })
  async countSectionContentImpact(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: SectionContentImpactQueryDto,
  ) {
    this.assertCustomActive(projectId, typeKey);
    return {
      data: await this.impactService.countSectionContentImpact(
        organizationId,
        projectId,
        typeKey,
        query.removedSectionKeys,
      ),
    };
  }

  @Get(':typeKey/tracking-link-revocation-impact')
  @ApiOperation({ summary: 'Count tracking source revocation impact' })
  @ApiQuery({
    name: 'revokedTrackingSourceTypeKeys',
    required: true,
    isArray: true,
    type: String,
  })
  @ApiResponse({ status: 404, description: 'Work-item type not found' })
  async countTrackingLinkRevocationImpact(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('typeKey') typeKey: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: TrackingLinkRevocationImpactQueryDto,
    @AuthToken() userToken: string | null,
  ) {
    this.assertCustomActive(projectId, typeKey);
    return {
      data: await this.impactService.countTrackingLinkRevocationImpact(
        organizationId,
        projectId,
        typeKey,
        query.revokedTrackingSourceTypeKeys,
        userToken,
      ),
    };
  }

  private assertCustom(
    projectId: ProjectId,
    typeKey: string,
    allowArchived = false,
  ): WorkItemTypeSummaryDto {
    const row = this.registry.getDefinition(projectId, typeKey);
    if (!row) {
      throw new NotFoundException(
        `Work-item type '${typeKey}' is not available in this project.`,
      );
    }
    if (row.effectiveSource !== WorkItemTypeEffectiveSource.ProjectCustom) {
      throw new ForbiddenException(
        `Canonical work-item type '${typeKey}' cannot be edited or hard-deleted.`,
      );
    }
    if (!allowArchived && row.status !== WorkItemTypeLifecycleStatus.Active) {
      throw new ForbiddenException(
        `Archived work-item type '${typeKey}' cannot be edited or archived.`,
      );
    }
    return row;
  }

  private assertActive(
    projectId: ProjectId,
    typeKey: string,
  ): WorkItemTypeSummaryDto {
    const row = this.registry.getDefinition(projectId, typeKey);
    this.logger.debug('Resolved work-item type archive target', {
      projectId,
      typeKey,
      status: row?.status ?? null,
      effectiveSource: row?.effectiveSource ?? null,
    });
    if (!row) {
      throw new NotFoundException(
        `Work-item type '${typeKey}' is not available in this project.`,
      );
    }
    if (row.status !== WorkItemTypeLifecycleStatus.Active) {
      throw new ForbiddenException(
        `Work-item type '${typeKey}' is not active in this project.`,
      );
    }
    return row;
  }

  private assertCustomActive(
    projectId: ProjectId,
    typeKey: string,
  ): WorkItemTypeSummaryDto {
    return this.assertCustom(projectId, typeKey);
  }

  private assertArchivedCustom(
    projectId: ProjectId,
    typeKey: string,
  ): WorkItemTypeSummaryDto {
    const row = this.assertCustom(projectId, typeKey, true);
    if (row.status !== WorkItemTypeLifecycleStatus.Archived) {
      throw new ForbiddenException(
        `Work-item type '${typeKey}' must be archived before it can be hard-deleted.`,
      );
    }
    return row;
  }
}
