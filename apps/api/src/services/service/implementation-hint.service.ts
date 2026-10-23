import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ImplementationHintExtractedFrom,
  ImplementationHintSourceType,
  Prisma,
} from '@prisma/client';
import { VersionConflictException } from '../../core/exceptions/version-conflict.exception';
import {
  AppendImplementationHintVersionDto,
  CreateImplementationHintDto,
  ImplementationHintCreatedEvent,
  ImplementationHintCreatedEventPayload,
  ImplementationHintDeletedEvent,
  ImplementationHintDeletedEventPayload,
  ImplementationHintDto as GeneratedImplementationHintDto,
  ImplementationHintUpdatedEvent,
  ImplementationHintUpdatedEventPayload,
  PayloadType,
  UpdateImplementationHintDto,
} from 'src/generated';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  ExtendedPrismaClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { ImplementationHintId, OrganizationId, ProjectId } from '../../types';
import { ensureStringDate } from '../../utils/date.util';

type PrismaTransaction = Prisma.TransactionClient;
type PrismaAccessor = PrismaTransaction | PrismaService['db'];
type ImplementationHintEventChanges = Record<string, unknown>;

export type FilePathMatchMode = 'exact' | 'prefix';

export interface ImplementationHintFileReferenceDto {
  id: string;
  hintId: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  createdAt: string;
}

export interface ImplementationHintVersionDto {
  id: string;
  hintId: string;
  version: number;
  hint: string;
  context?: Prisma.JsonValue;
  extractedFrom: ImplementationHintExtractedFrom;
  confidence?: number;
  createdAt: string;
}

export interface ImplementationHintRecordDto {
  id: string;
  serviceId: string;
  agentSessionId: string;
  featureName: string;
  description: string;
  sourceType: ImplementationHintSourceType;
  hint?: string;
  context?: Prisma.JsonValue;
  extractedFrom?: ImplementationHintExtractedFrom;
  confidence?: number;
  version: number;
  fileReferences: ImplementationHintFileReferenceDto[];
  versions: ImplementationHintVersionDto[];
  latestVersion?: ImplementationHintVersionDto;
  createdAt: string;
  updatedAt: string;
}

export type CreateHintVersionDto = AppendImplementationHintVersionDto;

export interface CreateHintFileReferenceDto {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface UpdateHintFileReferenceDto {
  filePath?: string;
  startLine?: number;
  endLine?: number;
}

export interface QueryHintFileReferencesDto {
  serviceId?: string;
  filePath?: string;
  filePathMatch?: FilePathMatchMode;
  latest?: boolean;
  page?: number;
  size?: number;
  confidence?: number;
  extractedFrom?: string;
}

export interface ListHintVersionsFilters {
  accessibleProjectIds?: string[];
  serviceId?: string;
  filePath?: string;
  filePathMatch?: FilePathMatchMode;
  latest?: boolean;
  page?: number;
  size?: number;
  confidence?: number;
  extractedFrom?: string;
}

interface ImplementationHintFilters {
  accessibleProjectIds?: string[];
  agentSessionId?: string;
  filePath?: string;
  filePathMatch?: FilePathMatchMode;
  latest?: boolean;
  page?: number;
  size?: number;
  confidence?: number;
  extractedFrom?: string;
}

interface FileReferenceFilters {
  filePath?: string;
  filePathMatch?: FilePathMatchMode;
  page?: number;
  size?: number;
}

interface NormalizedHintInput {
  featureName?: string;
  description?: string;
  sourceType?: string;
  agentSessionId?: string;
  versionSeed?: NormalizedVersionPayload;
  fileReferences?: NormalizedFileReference[];
  hint?: string;
  context?: Prisma.JsonValue;
  extractedFrom?: ImplementationHintExtractedFrom;
  confidence?: number;
}

interface NormalizedVersionPayload {
  hint: string;
  context?: Prisma.JsonValue;
  extractedFrom: ImplementationHintExtractedFrom;
  confidence?: number;
}

interface NormalizedAppendVersionInput extends NormalizedVersionPayload {
  expectedVersion: number;
  fileReferences?: NormalizedFileReference[];
}

interface NormalizedFileReference {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

interface NormalizedFindFilters {
  agentSessionId?: string;
  filePath?: string;
  filePathMatch: FilePathMatchMode;
  latest: boolean;
  page: number;
  size: number;
  confidence?: number;
  extractedFrom?: ImplementationHintExtractedFrom;
}

type ImplementationHintWithRelations = Prisma.ImplementationHintGetPayload<{
  include: {
    versions: true;
    fileReferences: true;
  };
}>;

const ALLOWED_SOURCE_TYPES = new Set(['USER', 'SYSTEM']);
const ALLOWED_EXTRACTED_FROM = new Set(['AGENT', 'USER']);
const ALLOWED_FILE_PATH_MATCH_MODES = new Set(['exact', 'prefix']);
const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 25;
const MAX_SIZE = 200;

interface ServiceEventContext {
  organizationId: OrganizationId;
  projectId: ProjectId;
}

@Injectable()
export class ImplementationHintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: DomainEventPublisher,
  ) {}

  async findAll(
    organizationId: OrganizationId,
    serviceId?: string,
    filters: ImplementationHintFilters = {},
  ): Promise<ImplementationHintRecordDto[]> {
    const normalizedServiceId = this.normalizeQueryId(serviceId, 'serviceId');
    if (normalizedServiceId) {
      await this.ensureServiceAccess(normalizedServiceId, organizationId);
    }

    const normalizedFilters = this.normalizeFindFilters(filters);

    const where = this.buildHintWhere(
      organizationId,
      normalizedServiceId,
      normalizedFilters,
    );

    const hints = await this.prisma.db.implementationHint.findMany({
      where: {
        ...where,
        ...(filters.accessibleProjectIds
          ? {
              AND: [
                {
                  service: { projectId: { in: filters.accessibleProjectIds } },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: (normalizedFilters.page - 1) * normalizedFilters.size,
      take: normalizedFilters.size,
      include: {
        versions: { orderBy: { version: 'desc' } },
        fileReferences: { orderBy: { createdAt: 'desc' } },
      },
    });

    return hints.map((hint) =>
      this.mapToRecordResponse(hint, normalizedFilters.latest),
    );
  }

  /**
   * Platform-admin debug read: every hint of every Service in a project,
   * archived Services included, grouped by Service.
   */
  async findAllByProjectGroupedByService(projectId: string): Promise<
    Array<{
      serviceId: string;
      serviceName: string;
      archivedAt: string | null;
      hints: ImplementationHintRecordDto[];
    }>
  > {
    const services = await this.prisma.db.service.findMany({
      where: { projectId },
      orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        archivedAt: true,
        implementationHints: {
          orderBy: { createdAt: 'desc' },
          include: {
            versions: { orderBy: { version: 'desc' } },
            fileReferences: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    return services.map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      archivedAt: service.archivedAt?.toISOString() ?? null,
      hints: service.implementationHints.map((hint) =>
        this.mapToRecordResponse(hint, true),
      ),
    }));
  }

  async findOne(
    organizationId: OrganizationId,
    hintId: string,
    serviceId?: string,
    latest = false,
  ): Promise<ImplementationHintRecordDto> {
    const hint = await this.findHintForAccess(
      this.prisma.db,
      organizationId,
      hintId,
      serviceId,
    );

    return this.mapToRecordResponse(hint, latest);
  }

  async create(
    organizationId: OrganizationId,
    dto: CreateImplementationHintDto,
  ): Promise<ImplementationHintRecordDto> {
    const normalized = this.normalizeCreateInput(dto);
    const normalizedServiceId = this.requireNonEmpty(
      dto.serviceId,
      'serviceId',
    );

    await this.ensureServiceAccess(normalizedServiceId, organizationId);

    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const eventContext = await this.requireServiceEventContext(
        tx,
        normalizedServiceId,
        organizationId,
      );
      await this.ensureAgentSessionExists(
        tx,
        normalized.agentSessionId as string,
        organizationId,
      );
      const created = await tx.implementationHint.create({
        data: {
          serviceId: normalizedServiceId,
          agentSessionId: normalized.agentSessionId as string,
          featureName: normalized.featureName as string,
          description: normalized.description as string,
          sourceType: normalized.sourceType as ImplementationHintSourceType,
          ...(normalized.versionSeed
            ? {
                hint: normalized.versionSeed.hint,
                context: this.toPrismaJson(normalized.versionSeed.context),
                extractedFrom: normalized.versionSeed.extractedFrom,
                confidence: normalized.versionSeed.confidence,
              }
            : {}),
        },
      });

      if (normalized.versionSeed) {
        await tx.implementationHintVersion.create({
          data: {
            hintId: created.id,
            version: 1,
            hint: normalized.versionSeed.hint,
            context: this.toPrismaJson(normalized.versionSeed.context),
            extractedFrom: normalized.versionSeed.extractedFrom,
            confidence: normalized.versionSeed.confidence,
          },
        });
      }

      await this.createFileReferences(
        tx,
        created.id,
        normalized.fileReferences ?? [],
      );

      const createdRecord = await this.findHintById(tx, created.id);
      await this.publishImplementationHintCreatedEvent(
        tx,
        createdRecord,
        eventContext,
      );

      return createdRecord;
    });
  }

  async update(
    organizationId: OrganizationId,
    hintId: string,
    dto: UpdateImplementationHintDto,
  ): Promise<ImplementationHintRecordDto> {
    const normalized = this.normalizeUpdateInput(dto);
    const normalizedServiceId = this.requireNonEmpty(
      dto.serviceId,
      'serviceId',
    );

    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const existing = await this.findHintForAccess(
        tx,
        organizationId,
        hintId,
        normalizedServiceId,
      );
      const eventContext = await this.requireServiceEventContext(
        tx,
        existing.serviceId,
        organizationId,
      );

      if (normalized.agentSessionId !== undefined) {
        await this.ensureAgentSessionExists(
          tx,
          normalized.agentSessionId,
          organizationId,
        );
      }
      await tx.implementationHint.update({
        where: { id: hintId },
        data: {
          ...(normalized.featureName !== undefined && {
            featureName: normalized.featureName,
          }),
          ...(normalized.description !== undefined && {
            description: normalized.description,
          }),
          ...(normalized.sourceType !== undefined && {
            sourceType: normalized.sourceType as ImplementationHintSourceType,
          }),
          ...(normalized.agentSessionId !== undefined && {
            agentSessionId: normalized.agentSessionId,
          }),
          ...(normalized.hint !== undefined && {
            hint: normalized.hint,
          }),
          ...(normalized.context !== undefined && {
            context: this.toPrismaJson(normalized.context),
          }),
          ...(normalized.extractedFrom !== undefined && {
            extractedFrom: normalized.extractedFrom,
          }),
          ...(normalized.confidence !== undefined && {
            confidence: normalized.confidence,
          }),
        },
      });

      const updatedRecord = await this.findHintById(tx, hintId);
      await this.publishImplementationHintUpdatedEvent(
        tx,
        updatedRecord,
        eventContext,
        this.buildUpdateChanges(normalized),
      );

      return updatedRecord;
    });
  }

  async appendVersion(
    organizationId: OrganizationId,
    hintId: string,
    dto: CreateHintVersionDto,
    serviceId?: string,
  ): Promise<ImplementationHintRecordDto> {
    const normalizedServiceId = this.normalizeQueryId(serviceId, 'serviceId');
    if (normalizedServiceId) {
      await this.ensureServiceAccess(normalizedServiceId, organizationId);
    }

    const normalized = this.normalizeVersionPayload(dto);

    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const hint = await this.findHintForAccess(
        tx,
        organizationId,
        hintId,
        normalizedServiceId,
      );
      const eventContext = await this.requireServiceEventContext(
        tx,
        hint.serviceId,
        organizationId,
      );

      if (hint.version !== normalized.expectedVersion) {
        throw new VersionConflictException(
          `Version conflict: expected ${normalized.expectedVersion}, got ${hint.version}`,
          normalized.expectedVersion,
          hint.version,
        );
      }

      const newVersion = hint.version + 1;
      const updateResult = await tx.implementationHint.updateMany({
        where: { id: hint.id, version: normalized.expectedVersion },
        data: {
          version: newVersion,
          hint: normalized.hint,
          context: this.toPrismaJson(normalized.context),
          extractedFrom: normalized.extractedFrom,
          confidence: normalized.confidence,
        },
      });

      if (updateResult.count !== 1) {
        const current = await tx.implementationHint.findUnique({
          where: { id: hint.id },
          select: { version: true },
        });

        throw new VersionConflictException(
          `Version conflict: expected ${normalized.expectedVersion}, got ${current?.version ?? hint.version}`,
          normalized.expectedVersion,
          current?.version ?? hint.version,
        );
      }

      await tx.implementationHintVersion.create({
        data: {
          hintId: hint.id,
          version: newVersion,
          hint: normalized.hint,
          context: this.toPrismaJson(normalized.context),
          extractedFrom: normalized.extractedFrom,
          confidence: normalized.confidence,
        },
      });

      const createdFileReferences = await this.createFileReferences(
        tx,
        hint.id,
        normalized.fileReferences ?? [],
      );

      const updatedRecord = await this.findHintById(tx, hint.id);
      await this.publishImplementationHintUpdatedEvent(
        tx,
        updatedRecord,
        eventContext,
        this.buildAppendVersionChanges(normalized, createdFileReferences),
      );

      return updatedRecord;
    });
  }

  async listVersions(
    organizationId: OrganizationId,
    hintId: string,
    latest = false,
    serviceId?: string,
  ): Promise<ImplementationHintVersionDto[]> {
    const hint = await this.findHintForAccess(
      this.prisma.db,
      organizationId,
      hintId,
      serviceId,
    );

    const versions = latest ? hint.versions.slice(0, 1) : hint.versions;
    return versions.map((version) => this.mapVersion(version));
  }

  async listOrganizationVersions(
    organizationId: OrganizationId,
    filters: ListHintVersionsFilters = {},
  ): Promise<ImplementationHintVersionDto[]> {
    const normalizedServiceId = this.normalizeQueryId(
      filters.serviceId,
      'serviceId',
    );
    if (normalizedServiceId) {
      await this.ensureServiceAccess(normalizedServiceId, organizationId);
    }

    const filePath = this.normalizeOptionalFilePath(
      filters.filePath,
      'filePath',
    );
    const filePathMatch = this.normalizeFilePathMatchMode(
      filters.filePathMatch,
    );
    const latest = filters.latest ?? false;
    const page = this.normalizePage(filters.page, 'page');
    const size = this.normalizePageSize(filters.size, 'size');
    const confidence = this.normalizeOptionalNumber(
      filters.confidence,
      'confidence',
    );
    const extractedFrom = this.normalizeOptionalExtractedFrom(
      filters.extractedFrom,
      'extractedFrom',
    );

    const hintScope = this.buildHintScopeWhere(
      organizationId,
      normalizedServiceId,
      filePath,
      filePathMatch,
    );
    const where: Prisma.ImplementationHintVersionWhereInput = {
      hintRecord: {
        ...hintScope,
        ...(filters.accessibleProjectIds
          ? {
              AND: [
                {
                  service: { projectId: { in: filters.accessibleProjectIds } },
                },
              ],
            }
          : {}),
      },
      ...(confidence !== undefined && { confidence }),
      ...(extractedFrom !== undefined && { extractedFrom }),
    };

    const versions = await this.prisma.db.implementationHintVersion.findMany({
      where,
      orderBy: latest
        ? [{ hintId: 'asc' }, { version: 'desc' }]
        : [{ createdAt: 'desc' }],
      ...(latest ? { distinct: ['hintId'] } : {}),
      skip: (page - 1) * size,
      take: size,
    });

    return versions.map((version) => this.mapVersion(version));
  }

  async createFileReference(
    organizationId: OrganizationId,
    hintId: string,
    dto: CreateHintFileReferenceDto,
    serviceId?: string,
  ): Promise<ImplementationHintFileReferenceDto> {
    await this.findHintForAccess(
      this.prisma.db,
      organizationId,
      hintId,
      serviceId,
    );
    const normalized = this.normalizeFileReference(dto, 'fileReference');

    const existing =
      await this.prisma.db.implementationHintFileReference.findFirst({
        where: {
          hintId,
          filePath: normalized.filePath,
          startLine: normalized.startLine ?? null,
          endLine: normalized.endLine ?? null,
        },
      });

    if (existing) {
      return this.mapFileReference(existing);
    }

    const created = await this.prisma.db.implementationHintFileReference.create(
      {
        data: {
          hintId,
          filePath: normalized.filePath,
          startLine: normalized.startLine,
          endLine: normalized.endLine,
        },
      },
    );

    return this.mapFileReference(created);
  }

  async listFileReferences(
    organizationId: OrganizationId,
    hintId: string,
    filters: FileReferenceFilters = {},
    serviceId?: string,
  ): Promise<ImplementationHintFileReferenceDto[]> {
    await this.findHintForAccess(
      this.prisma.db,
      organizationId,
      hintId,
      serviceId,
    );

    const normalized = this.normalizeFileReferenceFilters(filters);
    const where: Prisma.ImplementationHintFileReferenceWhereInput = {
      hintId,
      ...(normalized.filePath
        ? {
            filePath:
              normalized.filePathMatch === 'prefix'
                ? { startsWith: normalized.filePath }
                : normalized.filePath,
          }
        : {}),
    };

    const refs = await this.prisma.db.implementationHintFileReference.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (normalized.page - 1) * normalized.size,
      take: normalized.size,
    });

    return refs.map((ref) => this.mapFileReference(ref));
  }

  async queryFileReferences(
    organizationId: OrganizationId,
    filters: QueryHintFileReferencesDto = {},
    accessibleProjectIds?: string[],
  ): Promise<ImplementationHintFileReferenceDto[]> {
    if (filters.latest !== undefined && typeof filters.latest !== 'boolean') {
      throw new BadRequestException('latest must be true or false');
    }

    const normalizedServiceId = this.normalizeQueryId(
      filters.serviceId,
      'serviceId',
    );
    if (normalizedServiceId) {
      await this.ensureServiceAccess(normalizedServiceId, organizationId);
    }

    const filePath = this.normalizeOptionalFilePath(
      filters.filePath,
      'filePath',
    );
    const filePathMatch = this.normalizeFilePathMatchMode(
      filters.filePathMatch,
    );
    const page = this.normalizePage(filters.page, 'page');
    const size = this.normalizePageSize(filters.size, 'size');
    const confidence = this.normalizeOptionalNumber(
      filters.confidence,
      'confidence',
    );
    const extractedFrom = this.normalizeOptionalExtractedFrom(
      filters.extractedFrom,
      'extractedFrom',
    );
    const latest = filters.latest ?? false;

    let latestHintIds: string[] | undefined;
    if (latest) {
      const latestVersions =
        await this.prisma.db.implementationHintVersion.findMany({
          where: {
            hintRecord: {
              ...(accessibleProjectIds
                ? {
                    AND: [
                      { service: { projectId: { in: accessibleProjectIds } } },
                    ],
                  }
                : {}),
              ...(normalizedServiceId
                ? { serviceId: normalizedServiceId }
                : { service: { organizationId, archivedAt: null } }),
              ...(confidence !== undefined && { confidence }),
              ...(extractedFrom !== undefined && { extractedFrom }),
            },
          },
          orderBy: [{ hintId: 'asc' }, { version: 'desc' }],
          distinct: ['hintId'],
          select: { hintId: true },
        });

      latestHintIds = latestVersions.map((version) => version.hintId);
      if (latestHintIds.length === 0) {
        return [];
      }
    }

    const where: Prisma.ImplementationHintFileReferenceWhereInput = {
      ...(filePath
        ? {
            filePath:
              filePathMatch === 'prefix' ? { startsWith: filePath } : filePath,
          }
        : {}),
      hint: {
        ...(accessibleProjectIds
          ? { AND: [{ service: { projectId: { in: accessibleProjectIds } } }] }
          : {}),
        ...(normalizedServiceId
          ? { serviceId: normalizedServiceId }
          : { service: { organizationId, archivedAt: null } }),
        ...(confidence !== undefined && { confidence }),
        ...(extractedFrom !== undefined && { extractedFrom }),
        ...(latestHintIds !== undefined && { id: { in: latestHintIds } }),
      },
    };

    const refs = await this.prisma.db.implementationHintFileReference.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * size,
      take: size,
    });

    return refs.map((ref) => this.mapFileReference(ref));
  }

  async getFileReference(
    organizationId: OrganizationId,
    hintId: string,
    fileReferenceId: string,
    serviceId?: string,
  ): Promise<ImplementationHintFileReferenceDto> {
    await this.findHintForAccess(
      this.prisma.db,
      organizationId,
      hintId,
      serviceId,
    );

    const ref = await this.prisma.db.implementationHintFileReference.findFirst({
      where: { id: fileReferenceId, hintId },
    });

    if (!ref) {
      throw new NotFoundException(
        'Implementation hint file reference not found',
      );
    }

    return this.mapFileReference(ref);
  }

  async updateFileReference(
    organizationId: OrganizationId,
    hintId: string,
    fileReferenceId: string,
    dto: UpdateHintFileReferenceDto,
    serviceId?: string,
  ): Promise<ImplementationHintFileReferenceDto> {
    await this.findHintForAccess(
      this.prisma.db,
      organizationId,
      hintId,
      serviceId,
    );

    const existing =
      await this.prisma.db.implementationHintFileReference.findFirst({
        where: { id: fileReferenceId, hintId },
      });

    if (!existing) {
      throw new NotFoundException(
        'Implementation hint file reference not found',
      );
    }

    const filePath =
      dto.filePath !== undefined
        ? this.normalizeOptionalFilePath(dto.filePath, 'fileReference.filePath')
        : existing.filePath;
    if (!filePath) {
      throw new BadRequestException('fileReference.filePath is required');
    }

    const nextStartLine =
      dto.startLine !== undefined
        ? this.normalizeOptionalPositiveInteger(
            dto.startLine,
            'fileReference.startLine',
          )
        : (existing.startLine ?? undefined);
    const nextEndLine =
      dto.endLine !== undefined
        ? this.normalizeOptionalPositiveInteger(
            dto.endLine,
            'fileReference.endLine',
          )
        : (existing.endLine ?? undefined);

    if (nextEndLine !== undefined && nextStartLine === undefined) {
      throw new BadRequestException(
        'fileReference.startLine is required when endLine is set',
      );
    }
    if (
      nextStartLine !== undefined &&
      nextEndLine !== undefined &&
      nextStartLine > nextEndLine
    ) {
      throw new BadRequestException(
        'fileReference.startLine must be <= endLine',
      );
    }

    const hasChanges =
      dto.filePath !== undefined ||
      dto.startLine !== undefined ||
      dto.endLine !== undefined;
    if (!hasChanges) {
      return this.mapFileReference(existing);
    }

    const updated = await this.prisma.db.implementationHintFileReference.update(
      {
        where: { id: fileReferenceId },
        data: {
          ...(dto.filePath !== undefined && { filePath }),
          ...(dto.startLine !== undefined && { startLine: nextStartLine }),
          ...(dto.endLine !== undefined && { endLine: nextEndLine }),
        },
      },
    );

    return this.mapFileReference(updated);
  }

  async deleteFileReference(
    organizationId: OrganizationId,
    hintId: string,
    fileReferenceId: string,
    serviceId?: string,
  ): Promise<void> {
    await this.findHintForAccess(
      this.prisma.db,
      organizationId,
      hintId,
      serviceId,
    );

    const ref = await this.prisma.db.implementationHintFileReference.findFirst({
      where: { id: fileReferenceId, hintId },
      select: { id: true },
    });

    if (!ref) {
      throw new NotFoundException(
        'Implementation hint file reference not found',
      );
    }

    await this.prisma.db.implementationHintFileReference.delete({
      where: { id: fileReferenceId },
    });
  }

  async remove(organizationId: OrganizationId, hintId: string): Promise<void> {
    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const hint = await this.findHintForAccess(tx, organizationId, hintId);
      const eventContext = await this.requireServiceEventContext(
        tx,
        hint.serviceId,
        organizationId,
      );

      await tx.implementationHint.delete({
        where: { id: hintId },
      });

      await this.publishImplementationHintDeletedEvent(
        tx,
        hintId,
        eventContext,
      );
    });
  }

  private normalizeCreateInput(
    dto: CreateImplementationHintDto,
  ): NormalizedHintInput {
    const featureName = this.requireNonEmpty(dto.featureName, 'featureName');
    const description = this.requireNonEmpty(dto.description, 'description');
    const sourceType = this.normalizeSourceType(dto.sourceType, 'sourceType');
    const agentSessionId = this.requireNonEmpty(
      dto.agentSessionId,
      'agentSessionId',
    );
    return {
      featureName,
      description,
      sourceType,
      agentSessionId,
      versionSeed: this.normalizeOptionalVersionSeed({
        hint: dto.hint,
        context: dto.context,
        extractedFrom: dto.extractedFrom,
        confidence: dto.confidence,
      }),
      fileReferences: this.normalizeOptionalFileReferences(
        dto.fileReferences,
        'fileReferences',
      ),
    };
  }

  private normalizeUpdateInput(
    dto: UpdateImplementationHintDto,
  ): NormalizedHintInput {
    const featureName =
      dto.featureName !== undefined
        ? this.requireNonEmpty(dto.featureName, 'featureName')
        : undefined;
    const description =
      dto.description !== undefined
        ? this.requireNonEmpty(dto.description, 'description')
        : undefined;
    const sourceType =
      dto.sourceType !== undefined
        ? this.normalizeSourceType(dto.sourceType, 'sourceType')
        : undefined;
    const agentSessionId = this.normalizeQueryId(
      dto.agentSessionId,
      'agentSessionId',
    );
    const hint =
      dto.hint !== undefined
        ? this.requireNonEmpty(dto.hint, 'hint')
        : undefined;
    const context =
      dto.context !== undefined
        ? this.normalizeOptionalJsonValue(dto.context, 'context')
        : undefined;
    const extractedFrom =
      dto.extractedFrom !== undefined
        ? this.normalizeExtractedFrom(dto.extractedFrom, 'extractedFrom')
        : undefined;
    const confidence =
      dto.confidence !== undefined
        ? this.normalizeOptionalNumber(dto.confidence, 'confidence')
        : undefined;

    return {
      featureName,
      description,
      sourceType,
      agentSessionId,
      hint,
      context,
      extractedFrom,
      confidence,
    };
  }

  private normalizeFindFilters(
    filters: ImplementationHintFilters,
  ): NormalizedFindFilters {
    return {
      agentSessionId: this.normalizeQueryId(
        filters.agentSessionId,
        'agentSessionId',
      ),
      filePath: this.normalizeOptionalFilePath(filters.filePath, 'filePath'),
      filePathMatch: this.normalizeFilePathMatchMode(filters.filePathMatch),
      latest: filters.latest ?? false,
      page: this.normalizePage(filters.page, 'page'),
      size: this.normalizePageSize(filters.size, 'size'),
      confidence: this.normalizeOptionalNumber(
        filters.confidence,
        'confidence',
      ),
      extractedFrom: this.normalizeOptionalExtractedFrom(
        filters.extractedFrom,
        'extractedFrom',
      ),
    };
  }

  private normalizeFileReferenceFilters(
    filters: FileReferenceFilters,
  ): Required<FileReferenceFilters> {
    return {
      filePath:
        this.normalizeOptionalFilePath(filters.filePath, 'filePath') ?? '',
      filePathMatch: this.normalizeFilePathMatchMode(filters.filePathMatch),
      page: this.normalizePage(filters.page, 'page'),
      size: this.normalizePageSize(filters.size, 'size'),
    };
  }

  private normalizeVersionPayload(
    dto: CreateHintVersionDto,
  ): NormalizedAppendVersionInput {
    const expectedVersion = this.normalizePositiveInteger(
      dto.expectedVersion,
      'expectedVersion',
    );

    const hint = this.requireNonEmpty(dto.hint, 'hint');
    const extractedFrom = this.normalizeExtractedFrom(
      dto.extractedFrom,
      'extractedFrom',
    );

    return {
      expectedVersion,
      hint,
      context: this.normalizeOptionalJsonValue(dto.context, 'context'),
      extractedFrom,
      confidence: this.normalizeOptionalNumber(dto.confidence, 'confidence'),
      fileReferences: this.normalizeOptionalFileReferences(
        dto.fileReferences,
        'fileReferences',
      ),
    };
  }

  private normalizeOptionalVersionSeed(raw: {
    hint?: unknown;
    context?: unknown;
    extractedFrom?: unknown;
    confidence?: unknown;
  }): NormalizedVersionPayload | undefined {
    const hasAnyVersionField =
      raw.hint !== undefined ||
      raw.context !== undefined ||
      raw.extractedFrom !== undefined ||
      raw.confidence !== undefined;

    if (!hasAnyVersionField) {
      return undefined;
    }

    return {
      hint: this.requireNonEmpty(
        typeof raw.hint === 'string' ? raw.hint : undefined,
        'hint',
      ),
      context: this.normalizeOptionalJsonValue(raw.context, 'context'),
      extractedFrom: this.normalizeExtractedFrom(
        raw.extractedFrom,
        'extractedFrom',
      ),
      confidence: this.normalizeOptionalNumber(raw.confidence, 'confidence'),
    };
  }

  private normalizeOptionalFileReferences(
    value: unknown,
    field: string,
  ): NormalizedFileReference[] | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException(`${field} must be an array`);
    }

    const refs = value.map((entry, index) =>
      this.normalizeFileReference(entry, `${field}[${index}]`),
    );

    return this.dedupeFileReferences(refs);
  }

  private normalizeFileReference(
    value: unknown,
    field: string,
  ): NormalizedFileReference {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException(`${field} must be an object`);
    }

    const ref = value as {
      filePath?: unknown;
      startLine?: unknown;
      endLine?: unknown;
    };

    const filePath = this.normalizeOptionalFilePath(
      ref.filePath,
      `${field}.filePath`,
    );
    if (!filePath) {
      throw new BadRequestException(`${field}.filePath is required`);
    }

    const startLine = this.normalizeOptionalPositiveInteger(
      ref.startLine,
      `${field}.startLine`,
    );
    const endLine = this.normalizeOptionalPositiveInteger(
      ref.endLine,
      `${field}.endLine`,
    );

    if (endLine !== undefined && startLine === undefined) {
      throw new BadRequestException(
        `${field}.startLine is required when endLine is set`,
      );
    }

    if (
      startLine !== undefined &&
      endLine !== undefined &&
      startLine > endLine
    ) {
      throw new BadRequestException(`${field}.startLine must be <= endLine`);
    }

    return {
      filePath,
      startLine,
      endLine,
    };
  }

  private dedupeFileReferences(
    refs: NormalizedFileReference[],
  ): NormalizedFileReference[] {
    const seen = new Set<string>();
    const result: NormalizedFileReference[] = [];

    for (const ref of refs) {
      const key = this.fileReferenceKey(ref);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(ref);
    }

    return result;
  }

  private buildHintWhere(
    organizationId: OrganizationId,
    serviceId: string | undefined,
    filters: NormalizedFindFilters,
  ): Prisma.ImplementationHintWhereInput {
    const filePathFilter = filters.filePath
      ? {
          fileReferences: {
            some: {
              filePath:
                filters.filePathMatch === 'prefix'
                  ? { startsWith: filters.filePath }
                  : filters.filePath,
            },
          },
        }
      : {};

    return {
      ...(serviceId
        ? { serviceId }
        : { service: { organizationId, archivedAt: null } }),
      ...(filters.agentSessionId && { agentSessionId: filters.agentSessionId }),
      ...filePathFilter,
      ...(filters.extractedFrom && { extractedFrom: filters.extractedFrom }),
      ...(filters.confidence !== undefined && {
        confidence: filters.confidence,
      }),
    };
  }

  private buildHintScopeWhere(
    organizationId: OrganizationId,
    serviceId: string | undefined,
    filePath?: string,
    filePathMatch: FilePathMatchMode = 'exact',
  ): Prisma.ImplementationHintWhereInput {
    const filePathFilter = filePath
      ? {
          fileReferences: {
            some: {
              filePath:
                filePathMatch === 'prefix'
                  ? { startsWith: filePath }
                  : filePath,
            },
          },
        }
      : {};

    return {
      ...(serviceId
        ? { serviceId }
        : { service: { organizationId, archivedAt: null } }),
      ...filePathFilter,
    };
  }

  private async ensureServiceAccess(
    serviceId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    const exists = await this.prisma.db.service.findFirst({
      where: { id: serviceId, organizationId, archivedAt: null },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException(
        `Service ${serviceId} not found in organization ${organizationId}`,
      );
    }
  }

  private async requireServiceEventContext(
    prisma: PrismaAccessor,
    serviceId: string,
    organizationId: OrganizationId,
  ): Promise<ServiceEventContext> {
    const client = prisma as PrismaService['db'];
    const service = await client.service.findFirst({
      where: { id: serviceId, organizationId, archivedAt: null },
      select: { organizationId: true, projectId: true },
    });

    if (!service) {
      throw new NotFoundException(
        `Service ${serviceId} not found in organization ${organizationId}`,
      );
    }

    if (!service.projectId) {
      throw new BadRequestException(
        `Implementation hint events require service ${serviceId} to have a projectId`,
      );
    }

    return {
      organizationId: service.organizationId as OrganizationId,
      projectId: service.projectId as ProjectId,
    };
  }

  private async findHintForAccess(
    prisma: PrismaAccessor,
    organizationId: OrganizationId,
    hintId: string,
    serviceId?: string,
  ): Promise<ImplementationHintWithRelations> {
    const normalizedServiceId = this.normalizeQueryId(serviceId, 'serviceId');
    if (normalizedServiceId) {
      await this.ensureServiceAccess(normalizedServiceId, organizationId);
    }

    const hintQuery: Parameters<
      ExtendedPrismaClient['implementationHint']['findFirst']
    >[0] = {
      where: normalizedServiceId
        ? { id: hintId, serviceId: normalizedServiceId }
        : { id: hintId, service: { organizationId, archivedAt: null } },
      include: {
        versions: { orderBy: { version: 'desc' } },
        fileReferences: { orderBy: { createdAt: 'desc' } },
      },
    };

    const client = prisma as PrismaService['db'];
    const hint = await client.implementationHint.findFirst(hintQuery);

    if (!hint) {
      throw new NotFoundException('Implementation hint not found');
    }

    return hint as ImplementationHintWithRelations;
  }

  private async findHintById(
    tx: PrismaTransaction,
    hintId: string,
  ): Promise<ImplementationHintRecordDto> {
    const hint = await tx.implementationHint.findUnique({
      where: { id: hintId },
      include: {
        versions: { orderBy: { version: 'desc' } },
        fileReferences: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!hint) {
      throw new NotFoundException('Implementation hint not found');
    }

    return this.mapToRecordResponse(hint, false);
  }

  private async ensureAgentSessionExists(
    tx: PrismaTransaction,
    agentSessionId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    const session = await tx.agentSession.findFirst({
      where: { id: agentSessionId, organizationId },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException('Agent session not found');
    }
  }

  private async createFileReferences(
    tx: PrismaTransaction,
    hintId: string,
    fileReferences: NormalizedFileReference[],
  ): Promise<NormalizedFileReference[]> {
    if (fileReferences.length === 0) {
      return [];
    }

    const existing = await tx.implementationHintFileReference.findMany({
      where: { hintId },
      select: {
        filePath: true,
        startLine: true,
        endLine: true,
      },
    });

    const existingKeys = new Set(
      existing.map((ref) => this.fileReferenceKey(ref)),
    );

    const toCreate = fileReferences.filter(
      (ref) => !existingKeys.has(this.fileReferenceKey(ref)),
    );

    if (toCreate.length === 0) {
      return [];
    }

    await tx.implementationHintFileReference.createMany({
      data: toCreate.map((ref) => ({
        hintId,
        filePath: ref.filePath,
        startLine: ref.startLine,
        endLine: ref.endLine,
      })),
    });

    return toCreate;
  }

  private mapToRecordResponse(
    hint: {
      id: string;
      serviceId: string;
      agentSessionId: string;
      featureName: string;
      description: string;
      sourceType: ImplementationHintSourceType;
      hint: string | null;
      context: Prisma.JsonValue | null;
      extractedFrom: ImplementationHintExtractedFrom | null;
      confidence: number | null;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      fileReferences: Array<{
        id: string;
        hintId: string;
        filePath: string;
        startLine: number | null;
        endLine: number | null;
        createdAt: Date;
      }>;
      versions: Array<{
        id: string;
        hintId: string;
        version: number;
        hint: string;
        context: Prisma.JsonValue | null;
        extractedFrom: ImplementationHintExtractedFrom;
        confidence: number | null;
        createdAt: Date;
      }>;
    },
    latestOnly: boolean,
  ): ImplementationHintRecordDto {
    const orderedVersions = latestOnly
      ? hint.versions.slice(0, 1)
      : hint.versions;
    const mappedVersions = orderedVersions.map((version) =>
      this.mapVersion(version),
    );
    const latestVersion = hint.versions[0]
      ? this.mapVersion(hint.versions[0])
      : undefined;

    return {
      id: hint.id,
      serviceId: hint.serviceId,
      agentSessionId: hint.agentSessionId,
      featureName: hint.featureName,
      description: hint.description,
      sourceType: hint.sourceType,
      hint: hint.hint ?? undefined,
      context: hint.context ?? undefined,
      extractedFrom: hint.extractedFrom ?? undefined,
      confidence: hint.confidence ?? undefined,
      version: hint.version,
      fileReferences: hint.fileReferences.map((ref) =>
        this.mapFileReference(ref),
      ),
      versions: mappedVersions,
      latestVersion,
      createdAt: ensureStringDate(hint.createdAt),
      updatedAt: ensureStringDate(hint.updatedAt),
    };
  }

  private toGeneratedImplementationHintDto(
    hint: ImplementationHintRecordDto,
  ): GeneratedImplementationHintDto {
    return {
      id: hint.id,
      serviceId: hint.serviceId,
      agentSessionId: hint.agentSessionId,
      featureName: hint.featureName,
      description: hint.description,
      sourceType: hint.sourceType,
      ...(hint.hint !== undefined ? { hint: hint.hint } : {}),
      ...(hint.context !== undefined
        ? { context: hint.context as { [key: string]: unknown } }
        : {}),
      ...(hint.extractedFrom !== undefined
        ? { extractedFrom: hint.extractedFrom }
        : {}),
      ...(hint.confidence !== undefined ? { confidence: hint.confidence } : {}),
      version: hint.version,
      fileReferences: hint.fileReferences.map((fileReference) => ({
        id: fileReference.id,
        hintId: fileReference.hintId,
        filePath: fileReference.filePath,
        ...(fileReference.startLine !== undefined
          ? { startLine: fileReference.startLine }
          : {}),
        ...(fileReference.endLine !== undefined
          ? { endLine: fileReference.endLine }
          : {}),
        createdAt: fileReference.createdAt,
      })),
      versions: hint.versions.map((version) => ({
        id: version.id,
        hintId: version.hintId,
        version: version.version,
        hint: version.hint,
        ...(version.context !== undefined
          ? { context: version.context as { [key: string]: unknown } }
          : {}),
        extractedFrom: version.extractedFrom,
        ...(version.confidence !== undefined
          ? { confidence: version.confidence }
          : {}),
        createdAt: version.createdAt,
      })),
      ...(hint.latestVersion !== undefined
        ? {
            latestVersion: {
              id: hint.latestVersion.id,
              hintId: hint.latestVersion.hintId,
              version: hint.latestVersion.version,
              hint: hint.latestVersion.hint,
              ...(hint.latestVersion.context !== undefined
                ? {
                    context: hint.latestVersion.context as {
                      [key: string]: unknown;
                    },
                  }
                : {}),
              extractedFrom: hint.latestVersion.extractedFrom,
              ...(hint.latestVersion.confidence !== undefined
                ? { confidence: hint.latestVersion.confidence }
                : {}),
              createdAt: hint.latestVersion.createdAt,
            },
          }
        : {}),
      createdAt: hint.createdAt,
      updatedAt: hint.updatedAt,
    } satisfies GeneratedImplementationHintDto;
  }

  private buildUpdateChanges(
    normalized: NormalizedHintInput,
  ): ImplementationHintEventChanges | undefined {
    const changes: ImplementationHintEventChanges = {};

    if (normalized.featureName !== undefined) {
      changes.featureName = normalized.featureName;
    }
    if (normalized.description !== undefined) {
      changes.description = normalized.description;
    }
    if (normalized.sourceType !== undefined) {
      changes.sourceType = normalized.sourceType;
    }
    if (normalized.hint !== undefined) {
      changes.hint = normalized.hint;
    }
    if (normalized.context !== undefined) {
      changes.context = normalized.context;
    }
    if (normalized.extractedFrom !== undefined) {
      changes.extractedFrom = normalized.extractedFrom;
    }
    if (normalized.confidence !== undefined) {
      changes.confidence = normalized.confidence;
    }
    if (normalized.agentSessionId !== undefined) {
      changes.agentSessionId = normalized.agentSessionId;
    }
    return Object.keys(changes).length > 0 ? changes : undefined;
  }

  private buildAppendVersionChanges(
    normalized: NormalizedAppendVersionInput,
    createdFileReferences: NormalizedFileReference[],
  ): ImplementationHintEventChanges {
    return {
      hint: normalized.hint,
      extractedFrom: normalized.extractedFrom,
      ...(normalized.context !== undefined
        ? { context: normalized.context }
        : {}),
      ...(normalized.confidence !== undefined
        ? { confidence: normalized.confidence }
        : {}),
      ...(createdFileReferences.length > 0
        ? { fileReferences: createdFileReferences }
        : {}),
    };
  }

  private async publishImplementationHintCreatedEvent(
    tx: PrismaTransaction,
    hint: ImplementationHintRecordDto,
    context: ServiceEventContext,
  ): Promise<void> {
    const implementationHint = this.toGeneratedImplementationHintDto(hint);
    const payload = {
      payloadType: PayloadType.ImplementationHintCreated,
      organizationId: context.organizationId,
      projectId: context.projectId,
      implementationHint,
    } satisfies ImplementationHintCreatedEventPayload;
    const event = {
      type: EVENT_TYPES.IMPLEMENTATION_HINT.CREATED,
      aggregateId: hint.id as ImplementationHintId,
      payload,
    } satisfies Omit<ImplementationHintCreatedEvent, 'id'>;

    await this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishImplementationHintUpdatedEvent(
    tx: PrismaTransaction,
    hint: ImplementationHintRecordDto,
    context: ServiceEventContext,
    changes?: ImplementationHintEventChanges,
  ): Promise<void> {
    const implementationHint = this.toGeneratedImplementationHintDto(hint);
    const payload = {
      payloadType: PayloadType.ImplementationHintUpdated,
      organizationId: context.organizationId,
      projectId: context.projectId,
      implementationHint,
      ...(changes ? { changes } : {}),
    } satisfies ImplementationHintUpdatedEventPayload;
    const event = {
      type: EVENT_TYPES.IMPLEMENTATION_HINT.UPDATED,
      aggregateId: hint.id as ImplementationHintId,
      payload,
    } satisfies Omit<ImplementationHintUpdatedEvent, 'id'>;

    await this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishImplementationHintDeletedEvent(
    tx: PrismaTransaction,
    hintId: string,
    context: ServiceEventContext,
  ): Promise<void> {
    const payload = {
      payloadType: PayloadType.ImplementationHintDeleted,
      organizationId: context.organizationId,
      projectId: context.projectId,
      implementationHintId: hintId as ImplementationHintId,
    } satisfies ImplementationHintDeletedEventPayload;
    const event = {
      type: EVENT_TYPES.IMPLEMENTATION_HINT.DELETED,
      aggregateId: hintId as ImplementationHintId,
      payload,
    } satisfies Omit<ImplementationHintDeletedEvent, 'id'>;

    await this.eventPublisher.publishInTransaction(tx, event);
  }

  private mapVersion(version: {
    id: string;
    hintId: string;
    version: number;
    hint: string;
    context: Prisma.JsonValue | null;
    extractedFrom: ImplementationHintExtractedFrom;
    confidence: number | null;
    createdAt: Date;
  }): ImplementationHintVersionDto {
    return {
      id: version.id,
      hintId: version.hintId,
      version: version.version,
      hint: version.hint,
      context: version.context ?? undefined,
      extractedFrom: version.extractedFrom,
      confidence: version.confidence ?? undefined,
      createdAt: ensureStringDate(version.createdAt),
    };
  }

  private mapFileReference(ref: {
    id: string;
    hintId: string;
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    createdAt: Date;
  }): ImplementationHintFileReferenceDto {
    return {
      id: ref.id,
      hintId: ref.hintId,
      filePath: ref.filePath,
      startLine: ref.startLine ?? undefined,
      endLine: ref.endLine ?? undefined,
      createdAt: ensureStringDate(ref.createdAt),
    };
  }

  private requireNonEmpty(value: string | undefined, field: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }
    return trimmed;
  }

  private normalizeSourceType(
    value: string | undefined,
    field: string,
  ): string {
    if (!value) {
      throw new BadRequestException(`${field} is required`);
    }
    if (!ALLOWED_SOURCE_TYPES.has(value)) {
      throw new BadRequestException(`${field} must be USER or SYSTEM`);
    }
    return value;
  }

  private normalizeExtractedFrom(
    value: unknown,
    field: string,
  ): ImplementationHintExtractedFrom {
    if (typeof value !== 'string' || !ALLOWED_EXTRACTED_FROM.has(value)) {
      throw new BadRequestException(`${field} must be AGENT or USER`);
    }

    return value as ImplementationHintExtractedFrom;
  }

  private normalizeOptionalExtractedFrom(
    value: unknown,
    field: string,
  ): ImplementationHintExtractedFrom | undefined {
    if (value === undefined) {
      return undefined;
    }

    return this.normalizeExtractedFrom(value, field);
  }

  private normalizeIdList(
    values: string[] | undefined,
    field: string,
  ): string[] {
    if (values === undefined) {
      return [];
    }
    return this.normalizeOptionalIdList(values, field) ?? [];
  }

  private normalizeOptionalIdList(
    values: string[] | undefined,
    field: string,
  ): string[] | undefined {
    if (values === undefined) {
      return undefined;
    }
    if (!Array.isArray(values)) {
      throw new BadRequestException(`${field} must be an array`);
    }
    const trimmed = values.map((value) => value?.trim() ?? '');
    if (trimmed.some((value) => value.length === 0)) {
      throw new BadRequestException(`${field} must not contain empty values`);
    }
    const unique = new Set(trimmed);
    if (unique.size !== trimmed.length) {
      throw new BadRequestException(`${field} must not contain duplicates`);
    }
    return trimmed;
  }

  private normalizeQueryId(
    value: string | undefined,
    field: string,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} must not be empty`);
    }
    return trimmed;
  }

  private normalizeOptionalFilePath(
    value: unknown,
    field: string,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} must not be empty`);
    }

    return trimmed;
  }

  private normalizeFilePathMatchMode(value: unknown): FilePathMatchMode {
    if (value === undefined) {
      return 'exact';
    }

    if (
      typeof value !== 'string' ||
      !ALLOWED_FILE_PATH_MATCH_MODES.has(value)
    ) {
      throw new BadRequestException('filePathMatch must be exact or prefix');
    }

    return value as FilePathMatchMode;
  }

  private normalizePage(value: number | undefined, field: string): number {
    if (value === undefined) {
      return DEFAULT_PAGE;
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }

    return value;
  }

  private normalizePageSize(value: number | undefined, field: string): number {
    if (value === undefined) {
      return DEFAULT_SIZE;
    }

    if (!Number.isInteger(value) || value <= 0 || value > MAX_SIZE) {
      throw new BadRequestException(
        `${field} must be a positive integer less than or equal to ${MAX_SIZE}`,
      );
    }

    return value;
  }

  private normalizeOptionalNumber(
    value: unknown,
    field: string,
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      typeof value !== 'number' ||
      Number.isNaN(value) ||
      !Number.isFinite(value)
    ) {
      throw new BadRequestException(`${field} must be a valid number`);
    }

    return value;
  }

  private normalizeOptionalPositiveInteger(
    value: unknown,
    field: string,
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    return this.normalizePositiveInteger(value, field);
  }

  private normalizePositiveInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }

    return value;
  }

  private normalizeOptionalJsonValue(
    value: unknown,
    field: string,
  ): Prisma.JsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      !Array.isArray(value) &&
      typeof value !== 'object'
    ) {
      throw new BadRequestException(`${field} must be valid JSON`);
    }

    return value as Prisma.JsonValue;
  }

  private toPrismaJson(
    value: Prisma.JsonValue | undefined,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return Prisma.JsonNull;
    }

    return value as Prisma.InputJsonValue;
  }

  private fileReferenceKey(ref: {
    filePath: string;
    startLine?: number | null;
    endLine?: number | null;
  }): string {
    return `${ref.filePath}:${ref.startLine ?? ''}:${ref.endLine ?? ''}`;
  }
}
