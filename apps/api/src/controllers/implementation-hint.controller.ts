import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProjectAccessService } from '../auth/services/project-access.service';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { CurrentOrganization } from '../auth/decorators/current-user.decorator';
import { OrganizationId } from '../types';
import {
  AppendImplementationHintVersionDto,
  CreateImplementationHintDto,
  UpdateImplementationHintDto,
} from 'src/generated';
import {
  CreateHintFileReferenceDto,
  FilePathMatchMode,
  ImplementationHintFileReferenceDto,
  ImplementationHintRecordDto,
  ImplementationHintService,
  ImplementationHintVersionDto,
  QueryHintFileReferencesDto,
  UpdateHintFileReferenceDto,
} from '../services/service/implementation-hint.service';

@ApiTags('ImplementationHints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/implementation-hints')
export class ImplementationHintController {
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly implementationHintService: ImplementationHintService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List implementation hints' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional filter)',
  })
  @ApiQuery({
    name: 'agentSessionId',
    required: false,
    description: 'Filter by agent session ID',
  })
  @ApiQuery({
    name: 'filePath',
    required: false,
    description: 'Filter by file path',
  })
  @ApiQuery({
    name: 'filePathMatch',
    required: false,
    description: 'filePath match mode: exact or prefix',
  })
  @ApiQuery({
    name: 'latest',
    required: false,
    description: 'If true, return only latest version in versions array',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based page number',
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Page size',
  })
  @ApiQuery({
    name: 'confidence',
    required: false,
    description: 'Exact confidence filter',
  })
  @ApiQuery({
    name: 'extractedFrom',
    required: false,
    description: 'Extraction source: AGENT or USER',
  })
  async findAll(
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
    @Query('agentSessionId') agentSessionId?: string,
    @Query('filePath') filePath?: string,
    @Query('filePathMatch') filePathMatch?: FilePathMatchMode,
    @Query('latest') latest?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('confidence') confidence?: string,
    @Query('extractedFrom') extractedFrom?: string,
  ): Promise<ImplementationHintRecordDto[]> {
    return this.implementationHintService.findAll(organizationId, serviceId, {
      accessibleProjectIds: await this.projectAccess.accessibleProjectIds(
        callerId,
        organizationId,
      ),
      agentSessionId,
      filePath,
      filePathMatch,
      latest: this.parseOptionalBoolean(latest, 'latest'),
      page: this.parseOptionalPositiveInteger(page, 'page'),
      size: this.parseOptionalPositiveInteger(size, 'size'),
      confidence: this.parseOptionalNumber(confidence, 'confidence'),
      extractedFrom,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create implementation hint' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async create(
    @Body() dto: CreateImplementationHintDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ImplementationHintRecordDto> {
    return this.implementationHintService.create(organizationId, dto);
  }

  @Get('versions')
  @ApiOperation({ summary: 'List implementation hint versions' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  @ApiQuery({
    name: 'filePath',
    required: false,
    description: 'Filter by file path',
  })
  @ApiQuery({
    name: 'filePathMatch',
    required: false,
    description: 'filePath match mode: exact or prefix',
  })
  @ApiQuery({
    name: 'latest',
    required: false,
    description: 'If true, return only latest version for each hint',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based page number',
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Page size',
  })
  @ApiQuery({
    name: 'confidence',
    required: false,
    description: 'Exact confidence filter',
  })
  @ApiQuery({
    name: 'extractedFrom',
    required: false,
    description: 'Extraction source: AGENT or USER',
  })
  async listOrganizationVersions(
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
    @Query('filePath') filePath?: string,
    @Query('filePathMatch') filePathMatch?: FilePathMatchMode,
    @Query('latest') latest?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('confidence') confidence?: string,
    @Query('extractedFrom') extractedFrom?: string,
  ): Promise<ImplementationHintVersionDto[]> {
    return this.implementationHintService.listOrganizationVersions(
      organizationId,
      {
        accessibleProjectIds: await this.projectAccess.accessibleProjectIds(
          callerId,
          organizationId,
        ),
        serviceId,
        filePath,
        filePathMatch,
        latest: this.parseOptionalBoolean(latest, 'latest'),
        page: this.parseOptionalPositiveInteger(page, 'page'),
        size: this.parseOptionalPositiveInteger(size, 'size'),
        confidence: this.parseOptionalNumber(confidence, 'confidence'),
        extractedFrom,
      },
    );
  }

  @Get(':hintId')
  @ApiOperation({ summary: 'Get implementation hint' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  @ApiQuery({
    name: 'latest',
    required: false,
    description: 'If true, return only latest version in versions array',
  })
  async findOne(
    @Param('hintId') hintId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
    @Query('latest') latest?: string,
  ): Promise<ImplementationHintRecordDto> {
    return this.implementationHintService.findOne(
      organizationId,
      hintId,
      serviceId,
      this.parseOptionalBoolean(latest, 'latest') ?? false,
    );
  }

  @Patch(':hintId')
  @ApiOperation({ summary: 'Update implementation hint' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  async update(
    @Param('hintId') hintId: string,
    @Body() dto: UpdateImplementationHintDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ImplementationHintRecordDto> {
    return this.implementationHintService.update(organizationId, hintId, dto);
  }

  @Post(':hintId/versions')
  @ApiOperation({ summary: 'Append implementation hint version' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  async appendVersion(
    @Param('hintId') hintId: string,
    @Body() dto: AppendImplementationHintVersionDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
  ): Promise<ImplementationHintRecordDto> {
    return this.implementationHintService.appendVersion(
      organizationId,
      hintId,
      dto,
      serviceId,
    );
  }

  @Post(':hintId/append-version')
  @ApiOperation({
    summary: 'Append implementation hint version (OpenAPI route)',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  async appendVersionAtOpenApiRoute(
    @Param('hintId') hintId: string,
    @Body() dto: AppendImplementationHintVersionDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
  ): Promise<ImplementationHintVersionDto> {
    const updated = await this.implementationHintService.appendVersion(
      organizationId,
      hintId,
      dto,
      serviceId,
    );
    if (!updated.latestVersion) {
      throw new NotFoundException('Implementation hint version not found');
    }

    return updated.latestVersion;
  }

  @Get(':hintId/versions')
  @ApiOperation({ summary: 'List implementation hint versions' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  @ApiQuery({
    name: 'latest',
    required: false,
    description: 'If true, return only latest version',
  })
  async listVersions(
    @Param('hintId') hintId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
    @Query('latest') latest?: string,
  ): Promise<ImplementationHintVersionDto[]> {
    return this.implementationHintService.listVersions(
      organizationId,
      hintId,
      this.parseOptionalBoolean(latest, 'latest') ?? false,
      serviceId,
    );
  }

  @Post(':hintId/file-references')
  @ApiOperation({ summary: 'Create implementation hint file reference' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  async createFileReference(
    @Param('hintId') hintId: string,
    @Body() dto: CreateHintFileReferenceDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
  ): Promise<ImplementationHintFileReferenceDto> {
    return this.implementationHintService.createFileReference(
      organizationId,
      hintId,
      dto,
      serviceId,
    );
  }

  @Get(':hintId/file-references')
  @ApiOperation({ summary: 'List implementation hint file references' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  @ApiQuery({
    name: 'filePath',
    required: false,
    description: 'Filter by file path',
  })
  @ApiQuery({
    name: 'filePathMatch',
    required: false,
    description: 'filePath match mode: exact or prefix',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based page number',
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Page size',
  })
  async listFileReferences(
    @Param('hintId') hintId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
    @Query('filePath') filePath?: string,
    @Query('filePathMatch') filePathMatch?: FilePathMatchMode,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<ImplementationHintFileReferenceDto[]> {
    return this.implementationHintService.listFileReferences(
      organizationId,
      hintId,
      {
        filePath,
        filePathMatch,
        page: this.parseOptionalPositiveInteger(page, 'page'),
        size: this.parseOptionalPositiveInteger(size, 'size'),
      },
      serviceId,
    );
  }

  @Get(':hintId/file-references/:fileReferenceId')
  @ApiOperation({ summary: 'Get implementation hint file reference' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiParam({ name: 'fileReferenceId', description: 'File reference ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  async getFileReference(
    @Param('hintId') hintId: string,
    @Param('fileReferenceId') fileReferenceId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
  ): Promise<ImplementationHintFileReferenceDto> {
    return this.implementationHintService.getFileReference(
      organizationId,
      hintId,
      fileReferenceId,
      serviceId,
    );
  }

  @Patch(':hintId/file-references/:fileReferenceId')
  @ApiOperation({ summary: 'Update implementation hint file reference' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiParam({ name: 'fileReferenceId', description: 'File reference ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  async updateFileReference(
    @Param('hintId') hintId: string,
    @Param('fileReferenceId') fileReferenceId: string,
    @Body() dto: UpdateHintFileReferenceDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
  ): Promise<ImplementationHintFileReferenceDto> {
    return this.implementationHintService.updateFileReference(
      organizationId,
      hintId,
      fileReferenceId,
      dto,
      serviceId,
    );
  }

  @Delete(':hintId/file-references/:fileReferenceId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete implementation hint file reference' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  @ApiParam({ name: 'fileReferenceId', description: 'File reference ID' })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'Service ID (optional)',
  })
  async removeFileReference(
    @Param('hintId') hintId: string,
    @Param('fileReferenceId') fileReferenceId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('serviceId') serviceId?: string,
  ): Promise<void> {
    await this.implementationHintService.deleteFileReference(
      organizationId,
      hintId,
      fileReferenceId,
      serviceId,
    );
  }

  @Post('file-references/query')
  @ApiOperation({ summary: 'Query implementation hint file references' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async queryFileReferences(
    @CurrentUser('userId') callerId: string,
    @Body() dto: QueryHintFileReferencesDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ImplementationHintFileReferenceDto[]> {
    return this.implementationHintService.queryFileReferences(
      organizationId,
      dto,
      await this.projectAccess.accessibleProjectIds(callerId, organizationId),
    );
  }

  @Delete(':hintId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete implementation hint' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'hintId', description: 'Implementation hint ID' })
  async remove(
    @Param('hintId') hintId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    await this.implementationHintService.remove(organizationId, hintId);
  }

  private parseOptionalBoolean(
    value: string | undefined,
    fieldName: string,
  ): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }

    throw new BadRequestException(`${fieldName} must be true or false`);
  }

  private parseOptionalPositiveInteger(
    value: string | undefined,
    fieldName: string,
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${fieldName} must be a positive integer`);
    }

    return parsed;
  }

  private parseOptionalNumber(
    value: string | undefined,
    fieldName: string,
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      throw new BadRequestException(`${fieldName} must be a valid number`);
    }

    return parsed;
  }
}
