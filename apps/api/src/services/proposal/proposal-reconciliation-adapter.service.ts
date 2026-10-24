import { serializableGraphProjection } from './future-graph';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Proposal } from '@prisma/client';
import type {
  FutureRevisionContent,
  ProposalReconciliationBasis,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { resolveWorkItemSectionContentKind } from '../tasks/task-section-schema-validator.registry';
import { ModuleRef } from '@nestjs/core';
import { FeatureRequirementAuthoringService } from '../tasks/feature-requirement-authoring.service';
import { TaskService } from '../tasks/task.service';
import { DesignDocService } from '../design-doc/design-doc.service';
import { EntityPromptTemplateService } from '../entity-prompt-template.service';
import { projectReconciliationContent } from './proposal-reconciliation-content';
import type { FeatureRequirementsSection, UpdateTaskDto } from 'src/generated';
import type { OrganizationId, ProjectId, TaskId } from 'src/types';
import { WorkItemChangeSetProjectorService } from './work-item-change-set-projector.service';
import type {
  ProjectedWorkItemChangeSetResponse,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';

const sections = {
  orderBy: [{ order: 'asc' }, { key: 'asc' }],
  include: {
    updates: {
      orderBy: { seq: 'asc' },
      select: { seq: true, updateHash: true },
    },
  },
} as const;
const taskInclude = {
  sections: { ...sections, orderBy: [...sections.orderBy] },
  serviceRelations: {
    orderBy: { serviceId: 'asc' },
    select: { serviceId: true },
  },
} satisfies Prisma.TaskInclude;
const docInclude = {
  sections: { ...sections, orderBy: [...sections.orderBy] },
} satisfies Prisma.DesignDocInclude;

/** Canonical editable content; service credentials and unrelated metadata never enter review. */
@Injectable()
export class ProposalReconciliationAdapterService {
  constructor(
    private readonly registry: WorkItemTypeRegistryService,
    private readonly modules: ModuleRef,
  ) {}

  async currentFutureContent(
    organizationId: string,
    projectId: string,
    targetEntityType: 'TASK' | 'DESIGN_DOC',
    targetEntityId: string,
  ): Promise<FutureRevisionContent> {
    if (targetEntityType === 'TASK') {
      const task = await this.modules
        .get(TaskService, { strict: false })
        .findOne(organizationId as OrganizationId, targetEntityId as TaskId);
      if (!task || task.projectId !== projectId)
        throw new NotFoundException('Future target no longer exists.');
      const { sections } = task;
      if (!sections)
        throw new Error(
          'Future target content is missing its required sections.',
        );
      const graph = this.registry.getGraphCapability(task.type, projectId)
        ? await this.readFutureGraph(organizationId, projectId, targetEntityId)
        : undefined;
      return { ...task, sections, ...(graph ? { graph } : {}) };
    }

    const doc = await this.modules
      .get(DesignDocService, { strict: false })
      .findOne(targetEntityId, organizationId as OrganizationId);
    if (!doc || doc.projectId !== projectId)
      throw new NotFoundException('Future target no longer exists.');
    const { sections } = doc;
    if (!sections)
      throw new Error(
        'Future target content is missing its required sections.',
      );
    return { ...doc, sections };
  }

  async readFutureGraph(
    organizationId: string,
    projectId: string,
    targetEntityId: string,
    db?: AnyTransactionClient,
  ): Promise<ProjectedWorkItemChangeSetResponse> {
    return serializableGraphProjection(
      await this.modules
        .get(WorkItemChangeSetProjectorService, { strict: false })
        .project({
          organizationId: organizationId as OrganizationId,
          projectId: projectId as ProjectId,
          request: {
            root: { refType: 'existing', id: targetEntityId },
            operations: [],
          },
          view: { kind: 'rootChildren', includeExternalRelationships: true },
          db,
        }),
    );
  }

  projectFutureGraph(
    organizationId: string,
    projectId: string,
    basis: ProjectedWorkItemChangeSetResponse,
    request: WorkItemChangeSetValidationRequest,
  ): Promise<ProjectedWorkItemChangeSetResponse> {
    return this.modules
      .get(WorkItemChangeSetProjectorService, { strict: false })
      .project({
        organizationId: organizationId as OrganizationId,
        projectId: projectId as ProjectId,
        request,
        basis,
        view: { kind: 'rootChildren', includeExternalRelationships: true },
      });
  }

  /** The LIVE baseline token reconciliation records; content currency is still compared by basis. */
  async liveFutureRevision(
    tx: AnyTransactionClient,
    organizationId: string,
    projectId: string,
    targetEntityType: 'TASK' | 'DESIGN_DOC',
    targetEntityId: string,
  ): Promise<string> {
    const scope = { organizationId, projectId };
    const basis =
      targetEntityType === 'TASK'
        ? await this.task(tx, scope, targetEntityId, false)
        : await this.designDoc(tx, scope, targetEntityId, false);
    return basis.version;
  }

  renderFutureTaskSections(
    projectId: string,
    taskType: string,
    sections: NonNullable<UpdateTaskDto['sections']>,
  ): Array<{ key: string; content: string }> {
    return this.modules
      .get(TaskService, { strict: false })
      .renderFutureTaskSections(projectId, taskType, sections);
  }

  async renderFutureRequirements(
    tx: AnyTransactionClient,
    organizationId: string,
    requirementOps: NonNullable<UpdateTaskDto['requirementOps']>,
    baselineSection: string,
  ): Promise<string> {
    return JSON.stringify(
      await this.prepareRequirementOperations(
        tx,
        organizationId,
        baselineSection === '' ? undefined : baselineSection,
        requirementOps,
      ),
    );
  }

  private async prepareRequirementOperations(
    tx: AnyTransactionClient,
    organizationId: string,
    currentSection: unknown,
    requirementOps: NonNullable<UpdateTaskDto['requirementOps']>,
  ): Promise<FeatureRequirementsSection> {
    const prepared = await this.modules
      .get(FeatureRequirementAuthoringService, { strict: false })
      .prepareRequirementOperations(currentSection, requirementOps, {
        organizationId,
        db: tx,
      });
    if (!prepared.success) {
      throw new BadRequestException(
        `requirementOps validation failed:\n${prepared.diagnostics
          .map((diagnostic) => `  ${diagnostic.field}: ${diagnostic.message}`)
          .join('\n')}`,
      );
    }
    return prepared.section;
  }

  futureContentBasis(
    targetEntityType: 'TASK' | 'DESIGN_DOC',
    content: FutureRevisionContent,
    projectId: string,
  ): Prisma.JsonObject {
    if (targetEntityType === 'TASK') {
      if (!('type' in content))
        throw new Error('Task future content must contain a work-item type.');
      const sections = Object.fromEntries(
        content.sections.map((section) => [
          section.key,
          this.projectFutureTaskSection(
            content.type,
            section.key,
            section.materializedMarkdown,
            projectId,
          ),
        ]),
      );
      return {
        type: content.type,
        name: content.name,
        priority: content.priority ?? null,
        tag: content.tag ?? null,
        initiativeId: content.initiativeId ?? null,
        parentTaskId: content.parentTaskId ?? null,
        assigneeId: content.assigneeId ?? null,
        dueDate: content.dueDate
          ? new Date(content.dueDate).toISOString()
          : null,
        config: content.config ?? null,
        sections,
        sectionOrder: Object.fromEntries(
          content.sections.map((section) => [section.key, section.order]),
        ),
      } as Prisma.JsonObject;
    }

    if ('type' in content)
      throw new Error('Design-doc future content cannot contain a task type.');
    return {
      name: content.name,
      template: content.template,
      tags: [...content.tags].sort(),
      summary: content.summary ?? null,
      parentEntityId: content.parentEntityId ?? null,
      parentEntityType: content.parentEntityType ?? null,
      sections: Object.fromEntries(
        content.sections.map((section) => [
          section.key,
          section.materializedMarkdown,
        ]),
      ),
      sectionOrder: Object.fromEntries(
        content.sections.map((section) => [section.key, section.order]),
      ),
    } as Prisma.JsonObject;
  }

  currentFutureBasisContent(
    targetEntityType: 'TASK' | 'DESIGN_DOC',
    basis: ProposalReconciliationBasis,
  ): Prisma.JsonObject {
    const content = basis.content;
    if (targetEntityType === 'TASK') {
      // Unset sections are stored as null but authored as '' in future content.
      const taskSections = Object.fromEntries(
        Object.entries(content.sections as Prisma.JsonObject).map(
          ([key, value]) => [key, value ?? ''],
        ),
      );
      return {
        type: content.type,
        name: content.name,
        priority: content.priority ?? null,
        tag: content.tag ?? null,
        initiativeId: content.initiativeId ?? null,
        parentTaskId: content.parentTaskId ?? null,
        assigneeId: content.assigneeId ?? null,
        dueDate: content.dueDate ?? null,
        config: content.config ?? null,
        sections: taskSections,
        sectionOrder: content.sectionOrder,
      } as Prisma.JsonObject;
    }

    return {
      name: content.name,
      template: content.template,
      tags: [...(content.tags as string[])].sort(),
      summary: content.summary ?? null,
      parentEntityId: content.parentEntityId ?? null,
      parentEntityType: content.parentEntityType ?? null,
      sections: Object.fromEntries(
        Object.entries(content.sections as Prisma.JsonObject).map(
          ([key, value]) => [key, value ?? ''],
        ),
      ),
      sectionOrder: content.sectionOrder,
    } as Prisma.JsonObject;
  }

  private projectFutureTaskSection(
    workItemType: string,
    key: string,
    value: string,
    projectId: string,
  ): unknown {
    if (value === '') return value;
    const definition = this.registry.getSectionDefinition(
      workItemType,
      key,
      projectId,
    );
    return definition &&
      resolveWorkItemSectionContentKind(definition) !== 'markdown'
      ? JSON.parse(value)
      : value;
  }

  async proposedTask(
    tx: AnyTransactionClient,
    proposal: Proposal,
    basis: ProposalReconciliationBasis,
  ): Promise<Prisma.JsonObject> {
    const updates = proposal.updates as UpdateTaskDto;
    const content = projectReconciliationContent(basis.content, updates);
    if (updates.requirementOps) {
      const sections = content.sections as Prisma.JsonObject;
      const originalSections = basis.content.sections as Record<
        string,
        unknown
      >;
      const prepared = await this.prepareRequirementOperations(
        tx,
        proposal.organizationId,
        originalSections.requirements,
        updates.requirementOps,
      );
      sections.requirements = prepared as unknown as Prisma.JsonObject;
      delete content.requirementOps;
    }
    return content;
  }

  async workItemType(
    tx: AnyTransactionClient,
    proposal: Proposal,
    lock: boolean,
  ): Promise<ProposalReconciliationBasis> {
    if (lock) {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${proposal.projectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM work_item_type WHERE project_id = ${proposal.projectId} AND type_key = ${proposal.targetEntityId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM work_item_type_template WHERE type_key = ${proposal.targetEntityId} FOR SHARE`;
    }
    const override = await tx.workItemType.findUnique({
      where: {
        projectId_typeKey: {
          projectId: proposal.projectId,
          typeKey: proposal.targetEntityId,
        },
      },
    });
    const row =
      override ??
      (await tx.workItemTypeTemplate.findUnique({
        where: { typeKey: proposal.targetEntityId },
      }));
    if (!row)
      throw new NotFoundException(
        'Work-item type proposal target no longer exists.',
      );
    const { id, updatedAt } = row;
    return {
      entityType: 'WORK_ITEM_TYPE',
      entityId: proposal.targetEntityId,
      version: `${override ? 'project' : 'canonical'}:${id}:${updatedAt.toISOString()}`,
      content: {
        definition: this.registry.materializeDefinition(
          row,
        ) as unknown as Prisma.JsonObject,
        lifecycleStatus: override?.lifecycleStatus ?? 'active',
      },
    };
  }

  async template(
    tx: AnyTransactionClient,
    proposal: Proposal,
    lock: boolean,
  ): Promise<ProposalReconciliationBasis> {
    if (lock) {
      const key = `entity-prompt-template:${proposal.projectId}:${proposal.targetEntityId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
    const rows: Prisma.EntityPromptTemplateRevisionGetPayload<object>[] =
      await tx.entityPromptTemplateRevision.findMany({
        where: {
          templateKey: proposal.targetEntityId,
          OR: [{ projectId: proposal.projectId }, { projectId: null }],
        },
        orderBy: [{ revisionNumber: 'asc' }, { id: 'asc' }],
      });
    const owner = this.modules.get(EntityPromptTemplateService, {
      strict: false,
    });
    const selected = owner.selectEffectiveRevision(
      proposal.targetEntityId,
      rows,
    );
    const canonical = owner.selectEffectiveRevision(
      proposal.targetEntityId,
      rows.filter((row) => row.projectId === null),
    );
    const content = (row: typeof selected) =>
      row
        ? {
            selector: row.selector,
            content: row.content,
            syntaxVersion: row.syntaxVersion,
            ownershipScope: row.ownershipScope,
          }
        : null;
    return {
      entityType: 'ENTITY_PROMPT_TEMPLATE',
      entityId: proposal.targetEntityId,
      version: rows
        .map((row) => `${row.id}:${row.lifecycleState}:${row.validationStatus}`)
        .join('|'),
      content: { effective: content(selected), canonical: content(canonical) },
    };
  }

  async proposedOwnedContent(
    tx: AnyTransactionClient,
    proposal: Proposal,
    basis: ProposalReconciliationBasis,
  ): Promise<Prisma.JsonObject> {
    const updates = proposal.updates as Prisma.JsonObject;
    if (proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
      return {
        ...basis.content,
        effective:
          updates.operation === 'RETIRE'
            ? basis.content.canonical
            : {
                selector: updates.selector,
                content: updates.content,
                syntaxVersion: updates.syntaxVersion,
                ownershipScope: 'PROJECT',
              },
      };
    }
    if (updates.resetToCanonical === 'RESET_TO_CANONICAL') {
      const canonical = await tx.workItemTypeTemplate.findUniqueOrThrow({
        where: { typeKey: proposal.targetEntityId },
      });
      return {
        definition: this.registry.materializeDefinition(
          canonical,
        ) as unknown as Prisma.JsonObject,
        lifecycleStatus: 'active',
      };
    }
    return {
      definition: updates.definition ?? basis.content.definition,
      lifecycleStatus: proposal.action === 'DELETE' ? 'archived' : 'active',
    };
  }

  async task(
    tx: AnyTransactionClient,
    proposal: Pick<Proposal, 'organizationId' | 'projectId'>,
    id: string,
    lock: boolean,
  ): Promise<ProposalReconciliationBasis> {
    if (lock) {
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${id}
        AND organization_id = ${proposal.organizationId}
        AND project_id = ${proposal.projectId} FOR UPDATE`;
    }
    const task: Prisma.TaskGetPayload<{ include: typeof taskInclude }> | null =
      await tx.task.findFirst({
        where: {
          id,
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
        },
        include: taskInclude,
      });
    if (!task) throw new NotFoundException('Proposal target no longer exists.');
    const sections = Object.fromEntries(
      task.sections.map((section) => {
        const definition = this.registry.getSectionDefinition(
          task.type,
          section.key,
          task.projectId,
        );
        const content = section.materializedMarkdown;
        return [
          section.key,
          definition &&
          resolveWorkItemSectionContentKind(definition) !== 'markdown' &&
          content !== null
            ? JSON.parse(content)
            : content,
        ];
      }),
    );
    return {
      entityType: 'TASK',
      entityId: id,
      version: [
        task.updatedAt.toISOString(),
        ...task.sections.map(
          (section) =>
            `${section.id}:${section.updatedAt.toISOString()}:${section.crdtSnapshotSeq}:${section.updates.map((update) => `${update.seq}:${update.updateHash}`).join(',')}`,
        ),
      ].join('|'),
      content: {
        name: task.name,
        type: task.type,
        tag: task.tag,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate?.toISOString() ?? null,
        assigneeId: task.assigneeId,
        parentTaskId: task.parentTaskId,
        initiativeId: task.initiativeId,
        config: task.config,
        archivedAt: task.archivedAt?.toISOString() ?? null,
        serviceIds: task.serviceRelations.map((service) => service.serviceId),
        sections,
        sectionOrder: Object.fromEntries(
          task.sections.map((section) => [section.key, section.order]),
        ),
      },
    };
  }

  async designDoc(
    tx: AnyTransactionClient,
    proposal: Pick<Proposal, 'organizationId' | 'projectId'>,
    id: string,
    lock: boolean,
  ): Promise<ProposalReconciliationBasis> {
    if (lock) {
      await tx.$queryRaw`SELECT id FROM design_docs WHERE id = ${id}
        AND organization_id = ${proposal.organizationId}
        AND project_id = ${proposal.projectId} FOR UPDATE`;
    }
    const doc: Prisma.DesignDocGetPayload<{
      include: typeof docInclude;
    }> | null = await tx.designDoc.findFirst({
      where: {
        id,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
      },
      include: docInclude,
    });
    if (!doc) throw new NotFoundException('Proposal target no longer exists.');
    return {
      entityType: 'DESIGN_DOC',
      entityId: id,
      version: [
        doc.updatedAt.toISOString(),
        ...doc.sections.map(
          (section) =>
            `${section.id}:${section.updatedAt.toISOString()}:${section.crdtSnapshotSeq}:${section.updates.map((update) => `${update.seq}:${update.updateHash}`).join(',')}`,
        ),
      ].join('|'),
      content: {
        name: doc.name,
        template: doc.template,
        status: doc.status,
        tags: doc.tags,
        summary: doc.summary,
        parentEntityId: doc.parentEntityId,
        parentEntityType: doc.parentEntityType,
        archivedAt: doc.archivedAt?.toISOString() ?? null,
        sections: Object.fromEntries(
          doc.sections.map((section) => [
            section.key,
            section.materializedMarkdown,
          ]),
        ),
        sectionOrder: Object.fromEntries(
          doc.sections.map((section) => [section.key, section.order]),
        ),
      },
    };
  }
}
