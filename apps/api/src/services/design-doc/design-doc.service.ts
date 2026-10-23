/**
 * Design Document Service
 *
 * Provides CRUD operations for design documents using the new template + sections model.
 * Includes helper adapters for the staged-content framework.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { DesignDocParentEntityType, EntityType, Prisma } from '@prisma/client';
import {
  AdrStatus,
  CreateDesignDocDto,
  DesignDocContentChangedEventPayload,
  DesignDocDraftSection,
  DesignDocLibraryNodeDto,
  DesignDocResponseDto,
  MaterializedDesignDocSection,
  UpdateDesignDocDto,
} from 'src/generated';
import { CreateDesignDocLinkDto } from 'src/generated/model/createDesignDocLinkDto';
import { DesignDocLinkEntityType } from 'src/generated/model/designDocLinkEntityType';
import { DesignDocLinkResponseDto } from 'src/generated/model/designDocLinkResponseDto';
import {
  DesignDocSectionRecord,
  DesignDocTemplateType,
  DesignDocWithSectionsRecord,
  MaterializedDesignDocResponseDto,
  TEMPLATE_SECTION_SPECS,
  isSupportedDesignDocTemplate,
} from 'src/types/design-doc.types';
import type { DesignDocContentChangedEvent } from '../../core/events/types/domain-events';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import { PrismaService } from '../../prisma/prisma.service';
import { DesignDocId, OrganizationId, ProjectId, UserId } from '../../types';
import { ensureStringDate } from '../../utils/date.util';
import { ArchiveOrchestrationService } from '../archive-orchestration/archive-orchestration.service';
import {
  buildDesignDocEventDoc,
  mapDesignDocSections,
} from 'src/utils/design-doc-event.util';
import { PlanDesignDocLinksService } from './plan-design-doc-links.service';

interface SectionNormalizationInput {
  template: DesignDocTemplateType;
  sections?: DesignDocDraftSection[];
}

type PrismaTransaction = Prisma.TransactionClient;

export type DesignDocUpdatePostCommit = {
  statusChange?: { previousStatus: string; newStatus: AdrStatus };
};

type LinkTargetType = 'task' | 'design-doc';
type LinkFilterType = 'taskId' | 'planId' | 'designDocId';

interface NormalizedLinkInput {
  entityType: LinkTargetType;
  entityId: string;
}

const ENTITY_TYPE_ALIASES: Record<string, LinkTargetType> = {
  task: 'task',
  tasks: 'task',
  'design-doc': 'design-doc',
  design_doc: 'design-doc',
  adr: 'design-doc',
  adrs: 'design-doc',
};

const RESPONSE_ENTITY_TYPE: Record<LinkTargetType, DesignDocLinkEntityType> = {
  task: 'task',
  'design-doc': 'design-doc',
};

const PARENT_ENTITY_TYPE_BY_LINK_TARGET: Record<
  LinkTargetType,
  DesignDocParentEntityType
> = {
  task: DesignDocParentEntityType.TASK,
  'design-doc': DesignDocParentEntityType.DESIGN_DOC,
};

const SECTION_RELATION_INCLUDE = {
  orderBy: { order: 'asc' } as const,
  select: {
    id: true,
    key: true,
    order: true,
    materializedMarkdown: true,
  },
};

@Injectable()
export class DesignDocService {
  private readonly logger = new Logger(DesignDocService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
    @Inject(forwardRef(() => ArchiveOrchestrationService))
    private readonly archiveOrchestrationService: ArchiveOrchestrationService,
    private readonly planDesignDocLinks: PlanDesignDocLinksService,
    @Optional() _redisService?: unknown,
  ) {}

  /**
   * Create a new design document with template-driven sections
   */
  async create(
    createDesignDocDto: CreateDesignDocDto & { organizationId: OrganizationId },
  ): Promise<DesignDocResponseDto> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      return this.createInTransaction(tx, createDesignDocDto);
    });
  }

  /**
   * Core design-doc creation logic that runs inside an existing Prisma
   * transaction.
   *
   * Use this when the caller needs to atomically combine design-doc creation
   * with other operations (e.g. proposal approval).
   */
  async createInTransaction(
    tx: PrismaTransaction,
    createDesignDocDto: CreateDesignDocDto & { organizationId: OrganizationId },
    explicitDesignDocId?: DesignDocId,
  ): Promise<DesignDocResponseDto> {
    const template = createDesignDocDto.template ?? 'ADR';
    this.assertSupportedTemplate(template);
    const normalizedSections = this.normalizeSections({
      template,
      sections: createDesignDocDto.sections,
    });

    const { records: sectionRecords } =
      this.prepareSectionPersistencePayload(normalizedSections);

    this.logger.log('Creating design document', {
      name: createDesignDocDto.name,
      organizationId: createDesignDocDto.organizationId,
      template,
      sectionCount: normalizedSections.length,
    });

    const parent = this.normalizeParentInput(
      createDesignDocDto.parentEntityId,
      createDesignDocDto.parentEntityType,
    );

    const created = (await tx.designDoc.create({
      data: {
        ...(explicitDesignDocId ? { id: explicitDesignDocId } : {}),
        name: createDesignDocDto.name,
        template,
        status:
          createDesignDocDto.status ??
          this.getDefaultStatusForTemplate(template),
        organizationId: createDesignDocDto.organizationId,
        projectId: createDesignDocDto.projectId,
        tags: createDesignDocDto.tags ?? [],
        summary: createDesignDocDto.summary,
        parentEntityId: parent?.id ?? null,
        parentEntityType: parent?.type ?? null,
        sections: {
          create: sectionRecords.map((section) => ({
            key: section.key,
            order: section.order,
            materializedMarkdown: section.materializedMarkdown,
          })),
        },
      },
      include: {
        sections: SECTION_RELATION_INCLUDE,
      },
    })) as unknown as DesignDocWithSectionsRecord;

    const eventDoc = buildDesignDocEventDoc(created);
    const projectIdForEvent = eventDoc.projectId as ProjectId | null;
    if (!projectIdForEvent) {
      throw new Error('Design doc is missing projectId');
    }

    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.DESIGN_DOC.CREATED,
      aggregateId: created.id as DesignDocId,
      payload: {
        payloadType: EVENT_TYPES.DESIGN_DOC.CREATED,
        designDoc: eventDoc,
        organizationId: eventDoc.organizationId as OrganizationId,
        projectId: projectIdForEvent,
      },
    });

    return this.mapToResponse(created);
  }

  /**
   * Find all design documents for an organization (paginated)
   */
  async findAll(
    organizationId: OrganizationId,
    filters?: {
      status?: string;
      tags?: string[];
      page?: number;
      limit?: number;
      projectId?: ProjectId;
      accessibleProjectIds?: string[];
      template?: DesignDocTemplateType;
      includeSectionKeys?: string[];
      taskId?: string;
      planId?: string;
      designDocId?: string;
    },
  ): Promise<DesignDocResponseDto[]> {
    this.logger.debug('Finding design documents', { organizationId, filters });

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      organizationId,
      ...(filters?.accessibleProjectIds
        ? { AND: [{ projectId: { in: filters.accessibleProjectIds } }] }
        : {}),
      archivedAt: null,
    };

    const linkFilters = {
      taskId: filters?.taskId,
      planId: filters?.planId,
      designDocId: filters?.designDocId,
    };
    const providedLinkFilters = Object.entries(linkFilters).filter(
      ([, value]) => Boolean(value),
    );
    if (providedLinkFilters.length > 1) {
      throw new BadRequestException(
        'Only one of taskId, planId, designDocId may be provided',
      );
    }
    if (providedLinkFilters.length === 1) {
      const [filterType, entityId] = providedLinkFilters[0]!;
      switch (filterType as LinkFilterType) {
        case 'taskId':
          where.parentEntityType = DesignDocParentEntityType.TASK;
          where.parentEntityId = entityId;
          break;
        case 'designDocId':
          where.parentEntityType = DesignDocParentEntityType.DESIGN_DOC;
          where.parentEntityId = entityId;
          break;
        case 'planId': {
          const linkedDesignDocIds = await this.resolvePlanLinkedDesignDocIds(
            organizationId,
            entityId as string,
          );
          if (linkedDesignDocIds.length === 0) {
            return [];
          }
          where.id = { in: linkedDesignDocIds };
          break;
        }
        default:
          break;
      }
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.projectId) {
      where.projectId = filters.projectId;
    }

    if (filters?.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }

    if (filters?.template) {
      where.template = filters.template;
    }

    const includeSectionKeys = filters?.includeSectionKeys;
    const includeSections =
      Array.isArray(includeSectionKeys) && includeSectionKeys.length > 0;
    const sectionsInclude = includeSections
      ? {
          ...SECTION_RELATION_INCLUDE,
          where: { key: { in: includeSectionKeys } },
        }
      : undefined;

    const designDocs = (await this.prisma.db.designDoc.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: includeSections ? { sections: sectionsInclude } : undefined,
    })) as unknown as DesignDocWithSectionsRecord[];

    if (!includeSections) {
      return designDocs.map((doc) =>
        this.mapToResponse(doc as DesignDocWithSectionsRecord, {
          includeSections: false,
        }),
      );
    }

    const hydratedDocs = await Promise.all(
      designDocs.map(async (doc) => ({
        ...doc,
        sections: await this.hydrateSections(doc.sections),
      })),
    );

    return hydratedDocs.map((doc) =>
      this.mapToResponse(doc as DesignDocWithSectionsRecord),
    );
  }

  async findManyByIdsWithFirstSection(
    organizationId: OrganizationId,
    ids: DesignDocId[],
  ): Promise<Map<DesignDocId, DesignDocResponseDto>> {
    if (ids.length === 0) {
      return new Map();
    }

    const docs = (await this.prisma.db.designDoc.findMany({
      where: {
        id: { in: ids },
        organizationId,
        archivedAt: null,
      },
      include: {
        sections: {
          ...SECTION_RELATION_INCLUDE,
          orderBy: { order: 'asc' },
          take: 1,
        },
      },
    })) as unknown as DesignDocWithSectionsRecord[];

    if (docs.length === 0) {
      return new Map();
    }

    const hydratedDocs = await Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        sections: await this.hydrateSections(doc.sections),
      })),
    );

    const responses = new Map<DesignDocId, DesignDocResponseDto>();
    for (const doc of hydratedDocs) {
      responses.set(doc.id as DesignDocId, this.mapToResponse(doc));
    }

    return responses;
  }

  async findManyByIdsWithSections(
    organizationId: OrganizationId,
    ids: DesignDocId[],
  ): Promise<Map<DesignDocId, DesignDocResponseDto>> {
    if (ids.length === 0) {
      return new Map();
    }

    const docs = (await this.prisma.db.designDoc.findMany({
      where: {
        id: { in: ids },
        organizationId,
        archivedAt: null,
      },
      include: {
        sections: {
          ...SECTION_RELATION_INCLUDE,
          orderBy: { order: 'asc' },
        },
      },
    })) as unknown as DesignDocWithSectionsRecord[];

    if (docs.length === 0) {
      return new Map();
    }

    const hydratedDocs = await Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        sections: await this.hydrateSections(doc.sections),
      })),
    );

    const responses = new Map<DesignDocId, DesignDocResponseDto>();
    for (const doc of hydratedDocs) {
      responses.set(doc.id as DesignDocId, this.mapToResponse(doc));
    }

    return responses;
  }

  /**
   * Retrieve a single design document
   */
  async findOne(
    id: string,
    organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto | null> {
    this.logger.debug('Finding design document by ID', { id, organizationId });

    const designDoc = (await this.prisma.db.designDoc.findFirst({
      where: { id, organizationId, archivedAt: null },
      include: {
        sections: SECTION_RELATION_INCLUDE,
      },
    })) as unknown as DesignDocWithSectionsRecord | null;

    if (!designDoc) {
      return null;
    }

    const hydratedSections = await this.hydrateSections(designDoc.sections);
    const hydratedDoc: DesignDocWithSectionsRecord = {
      ...designDoc,
      sections: hydratedSections,
    };

    return this.mapToResponse(hydratedDoc);
  }

  /**
   * Update a design document
   */
  async update(
    id: string,
    updateDesignDocDto: UpdateDesignDocDto,
    organizationId: OrganizationId,
    userId?: UserId,
  ): Promise<DesignDocResponseDto> {
    const { response, postCommit } = await this.prisma.$transaction(
      async (tx: PrismaTransaction) => {
        return this.updateInTransaction(
          tx,
          id,
          updateDesignDocDto,
          organizationId,
          userId,
        );
      },
    );

    await this.runUpdatePostCommit(
      organizationId,
      id as DesignDocId,
      postCommit,
    );

    return response;
  }

  /**
   * Runs the post-commit side effects produced by {@link updateInTransaction}.
   * Shared between the {@link update} wrapper and the proposal-approval flow.
   */
  async runUpdatePostCommit(
    organizationId: OrganizationId,
    designDocId: DesignDocId,
    postCommit: DesignDocUpdatePostCommit,
  ): Promise<void> {
    if (postCommit.statusChange) {
    }
  }

  async runRemovePostCommit(
    organizationId: OrganizationId,
    designDocId: DesignDocId,
  ): Promise<void> {
    await this.archiveOrchestrationService.archiveDesignDocDependencies({
      designDocId,
      organizationId,
    });
  }

  /**
   * Transaction-aware design-doc update path. Mirrors {@link update} but runs
   * inside the caller's tx so the entity write can be atomic with whatever
   * the caller is coordinating (e.g. the proposal-row state machine flipping
   * DRAFT → APPROVED).
   *
   * Returns the response DTO plus a `postCommit` payload describing any side
   * effects the caller must run after its tx commits.
   */
  async updateInTransaction(
    tx: PrismaTransaction,
    id: string,
    updateDesignDocDto: UpdateDesignDocDto,
    organizationId: OrganizationId,
    _userId?: UserId,
  ): Promise<{
    response: DesignDocResponseDto;
    postCommit: DesignDocUpdatePostCommit;
  }> {
    const {
      name,
      template,
      status,
      projectId,
      tags,
      summary,
      sections,
      sectionUpdateSource: _sectionUpdateSource,
    } = updateDesignDocDto;

    const metadataUpdateDto: Partial<
      Pick<
        UpdateDesignDocDto,
        'name' | 'template' | 'status' | 'projectId' | 'tags' | 'summary'
      >
    > = {
      ...(name !== undefined && { name }),
      ...(template !== undefined && { template }),
      ...(status !== undefined && { status }),
      ...(projectId !== undefined && { projectId }),
      ...(tags !== undefined && { tags }),
      ...(summary !== undefined && { summary }),
    };
    const sectionUpdates = this.normalizeSectionPatchUpdates(sections);

    const parentTouched =
      'parentEntityId' in updateDesignDocDto ||
      'parentEntityType' in updateDesignDocDto;
    const parentUpdate = parentTouched
      ? this.resolveParentUpdate(
          updateDesignDocDto.parentEntityId,
          updateDesignDocDto.parentEntityType as
            | DesignDocParentEntityType
            | null
            | undefined,
        )
      : undefined;

    this.logger.log('Updating design document', {
      id,
      organizationId,
      metadataFields: Object.keys(metadataUpdateDto),
      hasSectionUpdates: sectionUpdates.length > 0,
      parentTouched,
    });

    if (
      metadataUpdateDto.template &&
      !isSupportedDesignDocTemplate(metadataUpdateDto.template)
    ) {
      throw new BadRequestException(
        `Unsupported design doc template: ${metadataUpdateDto.template}`,
      );
    }

    const existing = (await tx.designDoc.findFirst({
      where: { id, organizationId, archivedAt: null },
      include: {
        sections: {
          orderBy: { order: 'asc' },
        },
      },
    })) as DesignDocWithSectionsRecord | null;

    if (!existing) {
      throw new NotFoundException(
        `Design document ${id} not found in organization ${organizationId}`,
      );
    }

    if (parentUpdate?.parentEntityId && parentUpdate?.parentEntityType) {
      await this.validateParentReassignment(
        tx,
        id,
        organizationId,
        parentUpdate.parentEntityId,
        parentUpdate.parentEntityType,
      );
    }

    if (
      Object.keys(metadataUpdateDto).length === 0 &&
      sectionUpdates.length === 0 &&
      parentUpdate === undefined
    ) {
      existing.sections = await this.hydrateSections(existing.sections, tx);
      return {
        response: this.mapToResponse(existing),
        postCommit: {},
      };
    }

    const statusChanged =
      metadataUpdateDto.status !== undefined &&
      existing.status !== metadataUpdateDto.status;
    const newStatus = statusChanged ? metadataUpdateDto.status : undefined;

    let currentDoc: DesignDocWithSectionsRecord = {
      ...existing,
      sections: await this.hydrateSections(existing.sections, tx),
    };

    if (Object.keys(metadataUpdateDto).length > 0 || parentUpdate) {
      const docUpdate = (await tx.designDoc.update({
        where: { id },
        data: {
          name: metadataUpdateDto.name ?? existing.name,
          template: metadataUpdateDto.template ?? existing.template,
          status: metadataUpdateDto.status ?? existing.status,
          projectId:
            metadataUpdateDto.projectId !== undefined
              ? metadataUpdateDto.projectId
              : existing.projectId,
          tags: metadataUpdateDto.tags ?? existing.tags,
          summary: metadataUpdateDto.summary ?? existing.summary,
          ...(parentUpdate && {
            parentEntityId: parentUpdate.parentEntityId,
            parentEntityType: parentUpdate.parentEntityType,
          }),
        },
        include: {
          sections: SECTION_RELATION_INCLUDE,
        },
      })) as DesignDocWithSectionsRecord;

      docUpdate.sections = await this.hydrateSections(docUpdate.sections, tx);
      currentDoc = docUpdate;

      const eventDoc = buildDesignDocEventDoc(docUpdate);
      const { sections: _sections, ...metadataEventDoc } = eventDoc;
      const projectIdForEvent = eventDoc.projectId as ProjectId | null;
      if (!projectIdForEvent) {
        throw new Error('Design doc is missing projectId');
      }

      await this.eventPublisher.publishInTransaction(tx, {
        type: EVENT_TYPES.DESIGN_DOC.UPDATED,
        aggregateId: docUpdate.id as DesignDocId,
        payload: {
          payloadType: EVENT_TYPES.DESIGN_DOC.UPDATED,
          designDoc: metadataEventDoc,
          organizationId: eventDoc.organizationId as OrganizationId,
          projectId: projectIdForEvent,
        },
      });

      if (existing.status !== docUpdate.status) {
        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.DESIGN_DOC.STATUS_CHANGED,
          aggregateId: docUpdate.id as DesignDocId,
          payload: {
            payloadType: EVENT_TYPES.DESIGN_DOC.STATUS_CHANGED,
            organizationId: eventDoc.organizationId as OrganizationId,
            projectId: projectIdForEvent,
            previousStatus: existing.status,
            newStatus: docUpdate.status,
          },
        });
      }
    }

    if (sectionUpdates.length > 0) {
      currentDoc = await this.applySectionUpdatesInTransaction(
        tx,
        id as DesignDocId,
        organizationId,
        sectionUpdates,
      );
    }

    return {
      response: this.mapToResponse(currentDoc),
      postCommit: {
        statusChange:
          statusChanged && newStatus
            ? {
                previousStatus: existing.status,
                newStatus: newStatus as AdrStatus,
              }
            : undefined,
      },
    };
  }

  async applySectionUpdates(
    designDocId: DesignDocId,
    organizationId: OrganizationId,
    updates: Array<{ key: string; content: string }>,
  ): Promise<void> {
    if (!updates.length) {
      return;
    }

    await this.ensureDesignDocAccess(designDocId, organizationId);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.applySectionUpdatesInTransaction(
        tx,
        designDocId,
        organizationId,
        updates,
      );
    });
  }

  /**
   * Soft-delete a design document
   */
  async remove(
    id: string,
    organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    this.logger.log('Archiving design document', { id, organizationId });

    const existing = await this.prisma.db.designDoc.findFirst({
      where: { id, organizationId, archivedAt: null },
      include: { sections: SECTION_RELATION_INCLUDE },
    });

    if (!existing) {
      throw new NotFoundException(
        `Design document ${id} not found in organization ${organizationId}`,
      );
    }

    const archivedDesignDoc = await this.prisma.$transaction(
      async (tx: PrismaTransaction) => {
        const updated = (await tx.designDoc.update({
          where: { id },
          data: {
            archivedAt: new Date(),
            updatedAt: new Date(),
          },
          include: {
            sections: SECTION_RELATION_INCLUDE,
          },
        })) as unknown as DesignDocWithSectionsRecord;

        updated.sections = await this.hydrateSections(updated.sections, tx);

        const eventDoc = buildDesignDocEventDoc(updated);
        const projectIdForEvent = eventDoc.projectId as ProjectId | null;
        if (!projectIdForEvent) {
          throw new Error('Design doc is missing projectId');
        }

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
          aggregateId: updated.id as DesignDocId,
          payload: {
            payloadType: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
            designDoc: eventDoc,
            organizationId: eventDoc.organizationId as OrganizationId,
            projectId: projectIdForEvent,
          },
        });

        return this.mapToResponse(updated);
      },
    );

    await this.archiveOrchestrationService.archiveDesignDocDependencies({
      designDocId: id as DesignDocId,
      organizationId,
    });

    return archivedDesignDoc;
  }

  /**
   * Transaction-aware soft-delete. Mirrors {@link remove} but archives the
   * doc and publishes `design_doc.archived` on the caller's tx, so the
   * deletion is atomic with whatever the caller coordinates (e.g. a proposal
   * row flipping DRAFT → APPROVED).
   *
   * Dependency archival (conversations, artifacts) issues HTTP calls and
   * cannot run inside that tx, so it is returned as a `runPostCommit`
   * closure the caller invokes after its tx commits — matching the
   * postCommit pattern {@link updateInTransaction} already uses.
   */
  async removeInTransaction(
    tx: PrismaTransaction,
    id: string,
    organizationId: OrganizationId,
  ): Promise<{ runPostCommit: () => Promise<void> }> {
    this.logger.log('Archiving design document in transaction', {
      id,
      organizationId,
    });

    const existing = await tx.designDoc.findFirst({
      where: { id, organizationId, archivedAt: null },
      include: { sections: SECTION_RELATION_INCLUDE },
    });

    if (!existing) {
      throw new NotFoundException(
        `Design document ${id} not found in organization ${organizationId}`,
      );
    }

    const updated = (await tx.designDoc.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
        sections: SECTION_RELATION_INCLUDE,
      },
    })) as unknown as DesignDocWithSectionsRecord;

    updated.sections = await this.hydrateSections(updated.sections, tx);

    const eventDoc = buildDesignDocEventDoc(updated);
    const projectIdForEvent = eventDoc.projectId as ProjectId | null;
    if (!projectIdForEvent) {
      throw new Error('Design doc is missing projectId');
    }

    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
      aggregateId: updated.id as DesignDocId,
      payload: {
        payloadType: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
        designDoc: eventDoc,
        organizationId: eventDoc.organizationId as OrganizationId,
        projectId: projectIdForEvent,
      },
    });

    return {
      runPostCommit: async () => {
        await this.runRemovePostCommit(organizationId, id as DesignDocId);
      },
    };
  }

  async restore(
    id: string,
    organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    this.logger.log('Restoring design document', { id, organizationId });

    const existing = await this.prisma.db.designDoc.findFirst({
      where: { id, organizationId, archivedAt: { not: null } },
      include: { sections: SECTION_RELATION_INCLUDE },
    });

    if (!existing) {
      throw new NotFoundException(
        `Design document ${id} not found or not archived in organization ${organizationId}`,
      );
    }

    const restoredDesignDoc = await this.prisma.$transaction(
      async (tx: PrismaTransaction) => {
        const updated = (await tx.designDoc.update({
          where: { id },
          data: {
            archivedAt: null,
            updatedAt: new Date(),
          },
          include: {
            sections: SECTION_RELATION_INCLUDE,
          },
        })) as unknown as DesignDocWithSectionsRecord;

        updated.sections = await this.hydrateSections(updated.sections, tx);

        const eventDoc = buildDesignDocEventDoc(updated);
        const projectIdForEvent = eventDoc.projectId as ProjectId | null;
        if (!projectIdForEvent) {
          throw new Error('Design doc is missing projectId');
        }

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.DESIGN_DOC.RESTORED,
          aggregateId: updated.id as DesignDocId,
          payload: {
            payloadType: EVENT_TYPES.DESIGN_DOC.RESTORED,
            designDoc: eventDoc,
            organizationId: eventDoc.organizationId as OrganizationId,
            projectId: projectIdForEvent,
          },
        });

        return this.mapToResponse(updated);
      },
    );

    await this.archiveOrchestrationService.restoreDesignDocDependencies({
      designDocId: id as DesignDocId,
      organizationId,
    });

    return restoredDesignDoc;
  }

  async getLinks(
    designDocId: string,
    organizationId: OrganizationId,
    includeDetails = false,
  ): Promise<DesignDocLinkResponseDto[]> {
    const designDoc = await this.prisma.db.designDoc.findFirst({
      where: { id: designDocId, organizationId, archivedAt: null },
      select: {
        id: true,
        parentEntityId: true,
        parentEntityType: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!designDoc) {
      throw new NotFoundException(
        `Design document ${designDocId} not found in organization ${organizationId}`,
      );
    }

    if (!designDoc.parentEntityId || !designDoc.parentEntityType) {
      return [];
    }

    const parentRecord = await this.fetchParentEntity(
      designDoc.parentEntityType,
      designDoc.parentEntityId,
      organizationId,
      includeDetails,
    );

    if (!parentRecord) {
      return [];
    }

    return [
      this.mapParentLink({
        designDocId,
        organizationId,
        parentEntityId: designDoc.parentEntityId,
        parentEntityType: designDoc.parentEntityType,
        createdAt: designDoc.createdAt,
        updatedAt: designDoc.updatedAt,
        details: parentRecord,
        includeDetails,
      }),
    ];
  }

  async createLinks(
    designDocId: string,
    organizationId: OrganizationId,
    links: CreateDesignDocLinkDto[],
  ): Promise<DesignDocLinkResponseDto[]> {
    if (!links || links.length === 0) {
      throw new BadRequestException('At least one link must be provided');
    }
    if (links.length > 1) {
      throw new BadRequestException(
        'A design document can only have one parent. Provide a single link payload.',
      );
    }

    const [normalized] = this.normalizeLinkInput(links);
    if (!normalized) {
      throw new BadRequestException('At least one link must be provided');
    }

    this.logger.log('Setting design document parent', {
      designDocId,
      organizationId,
      parentEntityType: normalized.entityType,
      parentEntityId: normalized.entityId,
    });

    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const designDoc = await tx.designDoc.findFirst({
        where: { id: designDocId, organizationId, archivedAt: null },
        select: {
          id: true,
          parentEntityId: true,
          parentEntityType: true,
        },
      });

      if (!designDoc) {
        throw new NotFoundException(
          `Design document ${designDocId} not found in organization ${organizationId}`,
        );
      }

      if (designDoc.parentEntityId) {
        throw new ConflictException(
          `Design document ${designDocId} already has a parent. Remove the existing link before setting a new one.`,
        );
      }

      if (
        normalized.entityType === 'design-doc' &&
        normalized.entityId === designDocId
      ) {
        throw new BadRequestException('Design document cannot link to itself');
      }

      await this.ensureParentExists(tx, normalized, organizationId);

      const parentEntityType =
        PARENT_ENTITY_TYPE_BY_LINK_TARGET[normalized.entityType];

      const updated = await tx.designDoc.update({
        where: { id: designDocId },
        data: {
          parentEntityId: normalized.entityId,
          parentEntityType,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const parentRecord = await this.fetchParentEntity(
        parentEntityType,
        normalized.entityId,
        organizationId,
        false,
        tx,
      );

      return [
        this.mapParentLink({
          designDocId,
          organizationId,
          parentEntityId: normalized.entityId,
          parentEntityType,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          details: parentRecord,
          includeDetails: false,
        }),
      ];
    });
  }

  async removeLink(
    designDocId: string,
    organizationId: OrganizationId,
    linkId: string,
  ): Promise<DesignDocLinkResponseDto> {
    this.logger.log('Clearing design document parent', {
      designDocId,
      organizationId,
      linkId,
    });

    return this.prisma.$transaction(
      async (tx: PrismaTransaction): Promise<DesignDocLinkResponseDto> => {
        const designDoc = await tx.designDoc.findFirst({
          where: { id: designDocId, organizationId, archivedAt: null },
          select: {
            id: true,
            parentEntityId: true,
            parentEntityType: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!designDoc) {
          throw new NotFoundException(
            `Design document ${designDocId} not found in organization ${organizationId}`,
          );
        }

        const expectedLinkId = this.linkIdForDesignDoc(designDocId);
        if (
          linkId !== expectedLinkId ||
          !designDoc.parentEntityId ||
          !designDoc.parentEntityType
        ) {
          throw new NotFoundException(
            `Link ${linkId} not found for design document ${designDocId}`,
          );
        }

        const previous = {
          parentEntityId: designDoc.parentEntityId,
          parentEntityType: designDoc.parentEntityType,
          createdAt: designDoc.createdAt,
        };

        const updated = await tx.designDoc.update({
          where: { id: designDocId },
          data: {
            parentEntityId: null,
            parentEntityType: null,
            updatedAt: new Date(),
          },
          select: { updatedAt: true },
        });

        return this.mapParentLink({
          designDocId,
          organizationId,
          parentEntityId: previous.parentEntityId,
          parentEntityType: previous.parentEntityType,
          createdAt: previous.createdAt,
          updatedAt: updated.updatedAt,
          details: null,
          includeDetails: false,
        });
      },
    );
  }

  async getLibrary(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<DesignDocLibraryNodeDto[]> {
    this.logger.debug('Building design doc library', {
      organizationId,
      projectId,
    });

    const initiativeMap = new Map<string, { id: string; name: string }>();
    const taskMap = new Map<
      string,
      {
        id: string;
        name: string;
        parentTaskId: string | null;
        initiativeId: string | null;
      }
    >();
    const designDocMap = new Map<string, { id: string; name: string }>();
    const designDocIds = new Set<string>();

    const addInitiatives = (
      initiatives: Array<{ id: string; name: string }>,
    ) => {
      for (const initiative of initiatives) {
        initiativeMap.set(initiative.id, initiative);
      }
    };

    const addTasks = (
      tasks: Array<{
        id: string;
        name: string;
        parentTaskId: string | null;
        initiativeId: string | null;
      }>,
    ) => {
      for (const task of tasks) {
        taskMap.set(task.id, task);
      }
    };

    const addDesignDocs = (docs: Array<{ id: string; name: string }>) => {
      for (const doc of docs) {
        designDocMap.set(doc.id, doc);
      }
    };
    const addDesignDocIds = (ids: string[]) => {
      for (const id of ids) {
        designDocIds.add(id);
      }
    };

    const originInitiatives = await this.prisma.db.initiative.findMany({
      where: {
        organizationId,
        archivedAt: null,
        originatingProjectId: projectId,
      },
      select: { id: true, name: true },
    });
    addInitiatives(originInitiatives);

    const projectInitiatives = await this.prisma.db.projectInitiative.findMany({
      where: { projectId },
      include: {
        initiative: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            archivedAt: true,
          },
        },
      },
    });
    addInitiatives(
      projectInitiatives
        .map((relation) => relation.initiative)
        .filter(
          (initiative) =>
            initiative.organizationId === organizationId &&
            initiative.archivedAt === null,
        )
        .map((initiative) => ({ id: initiative.id, name: initiative.name })),
    );

    const projectInitiativeIds = Array.from(initiativeMap.keys());

    const tasksFromInitiatives =
      projectInitiativeIds.length > 0
        ? await this.prisma.db.task.findMany({
            where: {
              organizationId,
              archivedAt: null,
              initiativeId: { in: projectInitiativeIds },
            },
            select: {
              id: true,
              name: true,
              parentTaskId: true,
              initiativeId: true,
            },
          })
        : [];
    addTasks(tasksFromInitiatives);

    const projectTasks = await this.prisma.db.projectTask.findMany({
      where: { projectId },
      include: {
        task: {
          select: {
            id: true,
            name: true,
            parentTaskId: true,
            initiativeId: true,
            organizationId: true,
            archivedAt: true,
          },
        },
      },
    });
    addTasks(
      projectTasks
        .map((relation) => relation.task)
        .filter(
          (task) =>
            task.organizationId === organizationId && task.archivedAt === null,
        )
        .map((task) => ({
          id: task.id,
          name: task.name,
          parentTaskId: task.parentTaskId,
          initiativeId: task.initiativeId,
        })),
    );

    const projectDesignDocs = await this.prisma.db.designDoc.findMany({
      where: { organizationId, archivedAt: null, projectId },
      select: { id: true, name: true },
    });
    addDesignDocIds(projectDesignDocs.map((doc) => doc.id));

    const projectTaskIds = Array.from(taskMap.keys());
    const docsParentedByProjectTask =
      projectTaskIds.length > 0
        ? await this.prisma.db.designDoc.findMany({
            where: {
              organizationId,
              archivedAt: null,
              parentEntityType: DesignDocParentEntityType.TASK,
              parentEntityId: { in: projectTaskIds },
            },
            select: { id: true },
          })
        : [];
    addDesignDocIds(docsParentedByProjectTask.map((doc) => doc.id));

    const hydrateDesignDocs = async (ids: string[]) => {
      if (ids.length === 0) {
        return [];
      }
      return this.prisma.db.designDoc.findMany({
        where: { id: { in: ids }, organizationId, archivedAt: null },
        select: { id: true, name: true },
      });
    };

    const hydratedInitialDocs = await hydrateDesignDocs(
      Array.from(designDocIds),
    );
    designDocMap.clear();
    addDesignDocs(hydratedInitialDocs);

    let expanded = true;
    while (expanded) {
      expanded = false;
      const currentDocIds = Array.from(designDocMap.keys());
      if (currentDocIds.length === 0) {
        break;
      }
      const childDocsWithParents = await this.prisma.db.designDoc.findMany({
        where: {
          id: { in: currentDocIds },
          parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
          parentEntityId: { not: null },
        },
        select: { parentEntityId: true },
      });
      const newParentIds = Array.from(
        new Set(
          childDocsWithParents
            .map((doc) => doc.parentEntityId)
            .filter((id): id is string => id !== null)
            .filter((id) => !designDocMap.has(id)),
        ),
      );
      if (newParentIds.length === 0) {
        continue;
      }
      const parentDocs = await hydrateDesignDocs(newParentIds);
      if (parentDocs.length === 0) {
        continue;
      }
      addDesignDocs(parentDocs);
      expanded = true;
    }

    const hydratedDesignDocIds = Array.from(designDocMap.keys());
    const parentRows =
      hydratedDesignDocIds.length > 0
        ? await this.prisma.db.designDoc.findMany({
            where: { id: { in: hydratedDesignDocIds }, organizationId },
            select: {
              id: true,
              parentEntityId: true,
              parentEntityType: true,
              createdAt: true,
            },
          })
        : [];

    const taskRelations = parentRows
      .filter((row) => row.parentEntityType === DesignDocParentEntityType.TASK)
      .map((row) => ({
        designDocId: row.id,
        taskId: row.parentEntityId as string,
        createdAt: row.createdAt,
      }));
    const docRelations = parentRows
      .filter(
        (row) => row.parentEntityType === DesignDocParentEntityType.DESIGN_DOC,
      )
      .map((row) => ({
        parentDesignDocId: row.parentEntityId as string,
        childDesignDocId: row.id,
        createdAt: row.createdAt,
      }));

    const missingTaskIds = taskRelations
      .map((relation) => relation.taskId)
      .filter((taskId) => !taskMap.has(taskId));
    if (missingTaskIds.length > 0) {
      const extraTasks = await this.prisma.db.task.findMany({
        where: { id: { in: missingTaskIds }, organizationId, archivedAt: null },
        select: {
          id: true,
          name: true,
          parentTaskId: true,
          initiativeId: true,
        },
      });
      addTasks(extraTasks);
    }

    const ensureTaskParents = async () => {
      const pendingParents = new Set<string>();
      for (const task of taskMap.values()) {
        if (task.parentTaskId && !taskMap.has(task.parentTaskId)) {
          pendingParents.add(task.parentTaskId);
        }
      }
      while (pendingParents.size > 0) {
        const batch = Array.from(pendingParents);
        pendingParents.clear();
        const parents = await this.prisma.db.task.findMany({
          where: { id: { in: batch }, organizationId, archivedAt: null },
          select: {
            id: true,
            name: true,
            parentTaskId: true,
            initiativeId: true,
          },
        });
        addTasks(parents);
        for (const parent of parents) {
          if (parent.parentTaskId && !taskMap.has(parent.parentTaskId)) {
            pendingParents.add(parent.parentTaskId);
          }
        }
      }
    };
    await ensureTaskParents();

    const missingInitiativeIds = new Set<string>();
    for (const task of taskMap.values()) {
      if (task.initiativeId && !initiativeMap.has(task.initiativeId)) {
        missingInitiativeIds.add(task.initiativeId);
      }
    }
    if (missingInitiativeIds.size > 0) {
      const extraInitiatives = await this.prisma.db.initiative.findMany({
        where: {
          id: { in: Array.from(missingInitiativeIds) },
          organizationId,
          archivedAt: null,
        },
        select: { id: true, name: true },
      });
      addInitiatives(extraInitiatives);
    }

    const designDocRecords = await this.prisma.db.designDoc.findMany({
      where: {
        id: { in: Array.from(designDocMap.keys()) },
        organizationId,
        archivedAt: null,
      },
      include: { sections: SECTION_RELATION_INCLUDE },
    });
    const hydratedDesignDocs = await Promise.all(
      designDocRecords.map(async (doc) => ({
        ...doc,
        sections: await this.hydrateSections(doc.sections),
      })),
    );
    const designDocResponses = new Map<string, DesignDocResponseDto>();
    designDocMap.clear();
    for (const doc of hydratedDesignDocs) {
      const response = this.mapToResponse(doc as DesignDocWithSectionsRecord);
      designDocResponses.set(doc.id, response);
      designDocMap.set(doc.id, { id: doc.id, name: response.name });
    }

    const initiativeNodes = new Map<string, DesignDocLibraryNodeDto>();
    const taskNodes = new Map<string, DesignDocLibraryNodeDto>();
    const designDocNodes = new Map<string, DesignDocLibraryNodeDto>();

    const buildNode = (
      type: DesignDocLibraryNodeDto['type'],
      id: string,
      name: string,
      designDoc?: DesignDocResponseDto,
    ): DesignDocLibraryNodeDto => ({
      type,
      id,
      name,
      ...(designDoc ? { designDoc } : {}),
      children: [],
    });

    for (const initiative of initiativeMap.values()) {
      initiativeNodes.set(
        initiative.id,
        buildNode('initiative', initiative.id, initiative.name),
      );
    }
    for (const doc of designDocMap.values()) {
      const response = designDocResponses.get(doc.id);
      if (!response) {
        continue;
      }
      designDocNodes.set(
        doc.id,
        buildNode('design-doc', doc.id, response.name, response),
      );
    }

    const rootTasks: DesignDocLibraryNodeDto[] = [];
    for (const task of taskMap.values()) {
      const taskNode = taskNodes.get(task.id);
      if (!taskNode) {
        continue;
      }
      if (task.parentTaskId && taskNodes.has(task.parentTaskId)) {
        taskNodes.get(task.parentTaskId)!.children.push(taskNode);
        continue;
      }
      if (task.initiativeId && initiativeNodes.has(task.initiativeId)) {
        initiativeNodes.get(task.initiativeId)!.children.push(taskNode);
        continue;
      }
      rootTasks.push(taskNode);
    }

    const docRelationsByChild = new Map<
      string,
      Array<{ parentDesignDocId: string; createdAt: Date }>
    >();
    for (const relation of docRelations) {
      if (!docRelationsByChild.has(relation.childDesignDocId)) {
        docRelationsByChild.set(relation.childDesignDocId, []);
      }
      docRelationsByChild.get(relation.childDesignDocId)!.push({
        parentDesignDocId: relation.parentDesignDocId,
        createdAt: relation.createdAt,
      });
    }

    const taskRelationsByDoc = new Map<
      string,
      Array<{ taskId: string; createdAt: Date }>
    >();
    for (const relation of taskRelations) {
      if (!taskRelationsByDoc.has(relation.designDocId)) {
        taskRelationsByDoc.set(relation.designDocId, []);
      }
      taskRelationsByDoc.get(relation.designDocId)!.push({
        taskId: relation.taskId,
        createdAt: relation.createdAt,
      });
    }

    const selectOldest = <T extends { createdAt: Date }>(
      relations: T[],
    ): T | undefined =>
      relations.reduce<T | undefined>(
        (oldest, relation) =>
          !oldest || relation.createdAt < oldest.createdAt ? relation : oldest,
        undefined,
      );

    const rootDesignDocs: DesignDocLibraryNodeDto[] = [];
    for (const doc of designDocMap.values()) {
      const docNode = designDocNodes.get(doc.id);
      if (!docNode) {
        continue;
      }

      const docParent = selectOldest(
        (docRelationsByChild.get(doc.id) ?? []).filter((relation) =>
          designDocNodes.has(relation.parentDesignDocId),
        ),
      );
      if (docParent) {
        designDocNodes.get(docParent.parentDesignDocId)!.children.push(docNode);
        continue;
      }

      const taskParent = selectOldest(
        (taskRelationsByDoc.get(doc.id) ?? []).filter((relation) =>
          taskNodes.has(relation.taskId),
        ),
      );
      if (taskParent) {
        taskNodes.get(taskParent.taskId)!.children.push(docNode);
        continue;
      }

      rootDesignDocs.push(docNode);
    }

    const roots: DesignDocLibraryNodeDto[] = [
      ...initiativeNodes.values(),
      ...rootTasks,
      ...rootDesignDocs,
    ];

    return this.pruneLibraryNodes(roots);
  }

  /**
   * Adapter helpers for external API integration
   */
  async createForAdapter(
    dto: CreateDesignDocDto,
    organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    return this.create({ ...dto, organizationId });
  }

  async findAllForAdapter(
    organizationId: OrganizationId,
    filters?: {
      status?: string;
      tags?: string[];
      page?: number;
      limit?: number;
      projectId?: ProjectId;
      accessibleProjectIds?: string[];
      template?: DesignDocTemplateType;
      includeSectionKeys?: string[];
      taskId?: string;
      planId?: string;
      designDocId?: string;
    },
  ): Promise<DesignDocResponseDto[]> {
    return this.findAll(organizationId, filters);
  }

  async findOneForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto | null> {
    return this.findOne(id, organizationId);
  }

  async updateForAdapter(
    id: string,
    dto: UpdateDesignDocDto,
    organizationId: OrganizationId,
    userId?: UserId,
  ): Promise<DesignDocResponseDto> {
    return this.update(id, dto, organizationId, userId);
  }

  async removeForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    return this.remove(id, organizationId);
  }

  async restoreForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<DesignDocResponseDto> {
    return this.restore(id, organizationId);
  }

  async getLinksForAdapter(
    designDocId: string,
    organizationId: OrganizationId,
    includeDetails = false,
  ): Promise<DesignDocLinkResponseDto[]> {
    return this.getLinks(designDocId, organizationId, includeDetails);
  }

  async createLinksForAdapter(
    designDocId: string,
    links: CreateDesignDocLinkDto | CreateDesignDocLinkDto[],
    organizationId: OrganizationId,
  ): Promise<DesignDocLinkResponseDto[]> {
    const payload = Array.isArray(links) ? links : [links];
    return this.createLinks(designDocId, organizationId, payload);
  }

  async removeLinkForAdapter(
    designDocId: string,
    linkId: string,
    organizationId: OrganizationId,
  ): Promise<DesignDocLinkResponseDto> {
    return this.removeLink(designDocId, organizationId, linkId);
  }

  async getLibraryForAdapter(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<DesignDocLibraryNodeDto[]> {
    return this.getLibrary(organizationId, projectId);
  }

  private pruneLibraryNodes(
    nodes: DesignDocLibraryNodeDto[],
  ): DesignDocLibraryNodeDto[] {
    const pruned: DesignDocLibraryNodeDto[] = [];
    for (const node of nodes) {
      if (node.type === 'design-doc') {
        pruned.push(node);
        continue;
      }
      const children = this.pruneLibraryNodes(node.children);
      if (children.length > 0) {
        pruned.push({ ...node, children });
      }
    }
    return pruned;
  }

  private async hydrateSections(
    sections: DesignDocSectionRecord[],
    _prismaClient: PrismaService['db'] | PrismaTransaction = this.prisma.db,
  ): Promise<DesignDocSectionRecord[]> {
    return sections;
  }

  private mapToResponse(
    prismaDoc: DesignDocWithSectionsRecord,
    options?: {
      includeSections?: boolean;
      sectionsOverride?: MaterializedDesignDocSection[];
    },
  ): MaterializedDesignDocResponseDto {
    const includeSections = options?.includeSections ?? true;
    const sections = includeSections
      ? (options?.sectionsOverride ?? mapDesignDocSections(prismaDoc))
      : undefined;
    const archivedAt = prismaDoc.archivedAt
      ? ensureStringDate(prismaDoc.archivedAt)
      : undefined;

    const response = {
      id: prismaDoc.id as DesignDocId,
      name: prismaDoc.name,
      template: prismaDoc.template,
      status: prismaDoc.status,
      organizationId: prismaDoc.organizationId as OrganizationId,
      projectId: prismaDoc.projectId
        ? (prismaDoc.projectId as ProjectId)
        : undefined,
      tags: prismaDoc.tags,
      parentEntityId: prismaDoc.parentEntityId ?? null,
      parentEntityType: prismaDoc.parentEntityType ?? null,
      createdAt: ensureStringDate(prismaDoc.createdAt),
      updatedAt: ensureStringDate(prismaDoc.updatedAt),
      ...(includeSections ? { sections } : {}),
      summary: prismaDoc.summary ?? undefined,
      ...(archivedAt ? { archivedAt } : {}),
    };

    return response as MaterializedDesignDocResponseDto;
  }

  private async resolvePlanLinkedDesignDocIds(
    organizationId: OrganizationId,
    planId: string,
  ): Promise<string[]> {
    const plan = await this.prisma.db.task.findFirst({
      where: { id: planId, organizationId, type: 'PLAN', archivedAt: null },
      select: { projectId: true },
    });
    if (plan?.projectId) {
      const ids = await this.planDesignDocLinks.resolve(
        organizationId,
        plan.projectId as ProjectId,
        planId,
      );
      if (ids.length) return ids;
    }
    return [];
  }

  private uniqueIds(ids: string[]): string[] {
    return Array.from(new Set(ids));
  }

  private prepareSectionPersistencePayload(
    sections: DesignDocDraftSection[],
    existingSections?: Map<string, DesignDocSectionRecord>,
    keysToRefresh?: Set<string>,
  ): {
    records: Array<{
      key: string;
      order: number;
      materializedMarkdown: string;
    }>;
    refreshedKeys: string[];
  } {
    const records: Array<{
      key: string;
      order: number;
      materializedMarkdown: string;
    }> = [];
    const refreshedKeys: string[] = [];

    sections.forEach((section, index) => {
      const order = section.order ?? index;
      const content = section.content ?? '';
      const existing = existingSections?.get(section.key);
      const requiresRefresh = !existing || keysToRefresh?.has(section.key);

      if (requiresRefresh) {
        records.push({
          key: section.key,
          order,
          materializedMarkdown: content,
        });
        refreshedKeys.push(section.key);
        return;
      }

      records.push({
        key: section.key,
        order,
        materializedMarkdown: existing.materializedMarkdown ?? content,
      });
    });

    return { records, refreshedKeys };
  }

  private resolveParentUpdate(
    parentEntityId: string | null | undefined,
    parentEntityType: DesignDocParentEntityType | null | undefined,
  ): {
    parentEntityId: string | null;
    parentEntityType: DesignDocParentEntityType | null;
  } {
    const idIsNullish = parentEntityId == null;
    const typeIsNullish = parentEntityType == null;

    if (idIsNullish && typeIsNullish) {
      return { parentEntityId: null, parentEntityType: null };
    }
    if (idIsNullish || typeIsNullish) {
      throw new BadRequestException(
        'parentEntityId and parentEntityType must be provided together',
      );
    }
    if (
      parentEntityType !== DesignDocParentEntityType.TASK &&
      parentEntityType !== DesignDocParentEntityType.DESIGN_DOC
    ) {
      throw new BadRequestException(
        `Unsupported parentEntityType: ${parentEntityType as string}`,
      );
    }
    return {
      parentEntityId: parentEntityId as string,
      parentEntityType: parentEntityType as DesignDocParentEntityType,
    };
  }

  private async validateParentReassignment(
    tx: PrismaTransaction,
    designDocId: string,
    organizationId: OrganizationId,
    parentEntityId: string,
    parentEntityType: DesignDocParentEntityType,
  ): Promise<void> {
    if (
      parentEntityType === DesignDocParentEntityType.DESIGN_DOC &&
      parentEntityId === designDocId
    ) {
      throw new BadRequestException(
        'Design document cannot be parented to itself',
      );
    }

    if (parentEntityType === DesignDocParentEntityType.TASK) {
      const task = await tx.task.findFirst({
        where: {
          id: parentEntityId,
          organizationId,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!task) {
        throw new NotFoundException(
          `Task ${parentEntityId} not found in organization ${organizationId}`,
        );
      }
      return;
    }

    const target = await tx.designDoc.findFirst({
      where: {
        id: parentEntityId,
        organizationId,
        archivedAt: null,
      },
      select: {
        id: true,
        parentEntityId: true,
        parentEntityType: true,
      },
    });
    if (!target) {
      throw new NotFoundException(
        `Design document ${parentEntityId} not found in organization ${organizationId}`,
      );
    }

    let cursor: {
      parentEntityId: string | null;
      parentEntityType: DesignDocParentEntityType | null;
    } = target;
    for (let depth = 0; depth < 100; depth++) {
      if (
        cursor.parentEntityType !== DesignDocParentEntityType.DESIGN_DOC ||
        !cursor.parentEntityId
      ) {
        return;
      }
      if (cursor.parentEntityId === designDocId) {
        throw new BadRequestException(
          'Cannot reparent design document to one of its own descendants',
        );
      }
      const next = await tx.designDoc.findFirst({
        where: {
          id: cursor.parentEntityId,
          organizationId,
          archivedAt: null,
        },
        select: {
          parentEntityId: true,
          parentEntityType: true,
        },
      });
      if (!next) {
        return;
      }
      cursor = next;
    }
  }

  private normalizeParentInput(
    parentEntityId: string | null | undefined,
    parentEntityType: DesignDocParentEntityType | null | undefined,
  ): { id: string; type: DesignDocParentEntityType } | null {
    if (!parentEntityId && !parentEntityType) {
      return null;
    }
    if (!parentEntityId || !parentEntityType) {
      throw new BadRequestException(
        'parentEntityId and parentEntityType must be provided together',
      );
    }
    if (
      parentEntityType !== DesignDocParentEntityType.TASK &&
      parentEntityType !== DesignDocParentEntityType.DESIGN_DOC
    ) {
      throw new BadRequestException(
        `Unsupported parentEntityType: ${parentEntityType as string}`,
      );
    }
    return { id: parentEntityId, type: parentEntityType };
  }

  private linkIdForDesignDoc(designDocId: string): string {
    return `parent:${designDocId}`;
  }

  private mapParentLink(args: {
    designDocId: string;
    organizationId: OrganizationId;
    parentEntityId: string;
    parentEntityType: DesignDocParentEntityType;
    createdAt: Date;
    updatedAt: Date;
    details: {
      name?: string | null;
      status?: string | null;
    } | null;
    includeDetails: boolean;
  }): DesignDocLinkResponseDto {
    const linkTargetType: LinkTargetType =
      args.parentEntityType === DesignDocParentEntityType.TASK
        ? 'task'
        : 'design-doc';
    return {
      id: this.linkIdForDesignDoc(args.designDocId),
      designDocId: args.designDocId,
      organizationId: args.organizationId,
      entityType: RESPONSE_ENTITY_TYPE[linkTargetType],
      entityId: args.parentEntityId,
      linkType: null,
      entityName: args.includeDetails
        ? (args.details?.name ?? null)
        : undefined,
      entityStatus: args.includeDetails
        ? (args.details?.status ?? null)
        : undefined,
      createdAt: ensureStringDate(args.createdAt),
      updatedAt: ensureStringDate(args.updatedAt),
    };
  }

  private async fetchParentEntity(
    parentEntityType: DesignDocParentEntityType,
    parentEntityId: string,
    organizationId: OrganizationId,
    includeDetails: boolean,
    tx?: PrismaTransaction,
  ): Promise<{ name?: string | null; status?: string | null } | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = tx ?? (this.prisma.db as unknown as PrismaTransaction);
    if (parentEntityType === DesignDocParentEntityType.TASK) {
      const task = await client.task.findFirst({
        where: { id: parentEntityId, organizationId, archivedAt: null },
        select: includeDetails
          ? { id: true, name: true, status: true }
          : { id: true },
      });
      return task as { name?: string | null; status?: string | null } | null;
    }
    const designDoc = await client.designDoc.findFirst({
      where: { id: parentEntityId, organizationId, archivedAt: null },
      select: includeDetails
        ? { id: true, name: true, status: true }
        : { id: true },
    });
    return designDoc as { name?: string | null; status?: string | null } | null;
  }

  private normalizeLinkInput(
    links: CreateDesignDocLinkDto[],
  ): NormalizedLinkInput[] {
    return links.map((link) => {
      const entityType = this.normalizeEntityType(link.entityType);
      const entityId = link.entityId?.trim();

      if (!entityId) {
        throw new BadRequestException('entityId is required for each link');
      }

      return {
        entityType,
        entityId,
      };
    });
  }

  private normalizeEntityType(value?: string | null): LinkTargetType {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('entityType is required for each link');
    }

    const canonical = ENTITY_TYPE_ALIASES[normalized];
    if (!canonical) {
      throw new BadRequestException(`Unsupported entity type: ${value}`);
    }

    return canonical;
  }

  private async ensureParentExists(
    tx: PrismaTransaction,
    link: NormalizedLinkInput,
    organizationId: OrganizationId,
  ): Promise<void> {
    if (link.entityType === 'task') {
      const task = await tx.task.findFirst({
        where: {
          id: link.entityId,
          organizationId,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!task) {
        throw new NotFoundException(
          `Task ${link.entityId} not found in organization ${organizationId}`,
        );
      }
      return;
    }
    const designDoc = await tx.designDoc.findFirst({
      where: {
        id: link.entityId,
        organizationId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!designDoc) {
      throw new NotFoundException(
        `Design document ${link.entityId} not found in organization ${organizationId}`,
      );
    }
  }

  private async ensureDesignDocAccess(
    designDocId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    const exists = await this.prisma.db.designDoc.findFirst({
      where: { id: designDocId, organizationId, archivedAt: null },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException(
        `Design document ${designDocId} not found in organization ${organizationId}`,
      );
    }
  }

  private normalizeSections(
    input: SectionNormalizationInput,
  ): DesignDocDraftSection[] {
    if (input.sections && input.sections.length > 0) {
      return this.dedupeAndSortSections(input.sections);
    }

    const preset = TEMPLATE_SECTION_SPECS[input.template] ?? [];
    if (preset.length === 0) {
      throw new BadRequestException(
        `Unsupported design doc template: ${input.template}`,
      );
    }
    return preset.map((key, index) => ({ key, order: index, content: '' }));
  }

  private normalizeSectionPatchUpdates(
    sections?: DesignDocDraftSection[],
  ): Array<{ key: string; content: string }> {
    if (!sections || sections.length === 0) {
      return [];
    }

    return sections.map((section) => {
      if (!section.key || typeof section.key !== 'string') {
        throw new BadRequestException(
          'Design doc section key is required for updates',
        );
      }
      if (typeof section.content !== 'string') {
        throw new BadRequestException(
          `Design doc section content must be a string for key: ${section.key}`,
        );
      }

      return {
        key: section.key,
        content: section.content,
      };
    });
  }

  private async applySectionUpdatesInTransaction(
    tx: Prisma.TransactionClient,
    designDocId: DesignDocId,
    organizationId: OrganizationId,
    updates: Array<{ key: string; content: string }>,
  ): Promise<DesignDocWithSectionsRecord> {
    const updateKeys = updates.map((update) => update.key);
    const uniqueUpdateKeys = Array.from(new Set(updateKeys));
    const sections = await tx.designDocSection.findMany({
      where: {
        designDocId,
        key: { in: uniqueUpdateKeys },
      },
      select: {
        id: true,
        key: true,
      },
    });

    if (sections.length !== uniqueUpdateKeys.length) {
      const sectionKeys = new Set(sections.map((section) => section.key));
      const missingKeys = uniqueUpdateKeys.filter(
        (key) => !sectionKeys.has(key),
      );
      throw new BadRequestException(
        `Design document ${designDocId} is missing required sections: ${missingKeys.join(', ')}`,
      );
    }

    const sectionMap = new Map(
      sections.map((section) => [section.key, section]),
    );

    for (const update of updates) {
      const existing = sectionMap.get(update.key);
      if (!existing) {
        throw new BadRequestException(
          `Design document ${designDocId} is missing required section: ${update.key}`,
        );
      }

      await tx.designDocSection.update({
        where: { id: existing.id },
        data: {
          materializedMarkdown: update.content,
        },
      });
    }

    const updatedDesignDoc = (await tx.designDoc.findFirst({
      where: {
        id: designDocId,
        organizationId,
        archivedAt: null,
      },
      include: {
        sections: SECTION_RELATION_INCLUDE,
      },
    })) as DesignDocWithSectionsRecord | null;

    if (!updatedDesignDoc) {
      throw new NotFoundException(
        `Design document ${designDocId} not found in organization ${organizationId}`,
      );
    }

    const hydrated = {
      ...updatedDesignDoc,
      sections: await this.hydrateSections(updatedDesignDoc.sections, tx),
    };

    const eventDoc = buildDesignDocEventDoc(hydrated);
    const projectIdForEvent = eventDoc.projectId as ProjectId | null;
    if (!projectIdForEvent) {
      throw new Error('Design doc is missing projectId');
    }

    const payload: DesignDocContentChangedEventPayload = {
      payloadType: EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED,
      designDoc: eventDoc,
      organizationId: eventDoc.organizationId as OrganizationId,
      projectId: projectIdForEvent,
    };

    const event: Omit<DesignDocContentChangedEvent, 'id'> = {
      type: EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED,
      aggregateId: designDocId,
      payload,
    };

    await this.eventPublisher.publishInTransaction(tx, event);

    return hydrated;
  }

  private dedupeAndSortSections(
    sections: DesignDocDraftSection[],
  ): DesignDocDraftSection[] {
    const map = new Map<string, DesignDocDraftSection>();
    sections.forEach((section, index) => {
      map.set(section.key, {
        key: section.key,
        content: section.content,
        order: section.order ?? index,
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      return orderA - orderB;
    });
  }

  private getDefaultStatusForTemplate(template: DesignDocTemplateType): string {
    switch (template) {
      case 'ADR':
        return 'ADR_CONTEXT';
      case 'DECISION':
      case 'BRAINSTORM':
      case 'PLAN_DOCUMENT':
        return 'REFINING_CONTENT';
      default:
        throw new BadRequestException(
          `Unsupported design doc template: ${template}`,
        );
    }
  }

  private assertSupportedTemplate(template: string): void {
    if (!isSupportedDesignDocTemplate(template)) {
      throw new BadRequestException(
        `Unsupported design doc template: ${template}`,
      );
    }
  }
}
