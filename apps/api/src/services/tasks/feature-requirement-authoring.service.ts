import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  FeatureRequirementInput,
  FeatureRequirementOperation,
  FeatureRequirementRecord,
  FeatureRequirementsSection,
} from '../../generated';
import type { AnyTransactionClient } from '../../prisma/prisma.service';
import type { OrganizationId } from '../../types';
import { loadProposalReferenceMetadata } from '../proposal/proposal-title-snapshot';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';
import {
  applyFeatureRequirementOperations,
  prepareFeatureRequirementOperations,
} from './feature-requirement-operations';
import {
  featureRequirementInputSchema,
  featureRequirementOperationSchema,
} from './feature-requirement-authoring.schemas';
import {
  type FeatureRequirementDraftRecord,
  type FeatureRequirementsDraftSection,
  validateFeatureRequirementsDraft,
  validateFeatureRequirementsSection,
} from './feature-requirements-section.validator';
import { canonicalDiagramType } from './diagram-metadata';

export interface FeatureRequirementDiagnostic {
  recordIndex?: number;
  field: string;
  code: string;
  message: string;
}

export type FeatureRequirementAuthoringResult =
  | {
      success: true;
      section: FeatureRequirementsSection;
      warnings: FeatureRequirementDiagnostic[];
    }
  | { success: false; diagnostics: FeatureRequirementDiagnostic[] };

export type FeatureRequirementPreparationResult =
  | {
      success: true;
      section: FeatureRequirementsSection;
      mintedRequirementIds: Record<string, string>;
      warnings: FeatureRequirementDiagnostic[];
    }
  | { success: false; diagnostics: FeatureRequirementDiagnostic[] };

export type FeatureRequirementTitleResolutionResult =
  | { success: true; section: FeatureRequirementsSection }
  | { success: false; diagnostics: FeatureRequirementDiagnostic[] };

export interface FeatureRequirementTitleContext {
  organizationId: string;
  db: AnyTransactionClient;
}

const CITATION_SLOTS = ['designedBy', 'fulfilledBy', 'contracts'] as const;
/** Work-item type key of mockups, which are cited in designedBy. */
const MOCKUP_TYPE = 'mockup';

/** Design work items cited in designedBy, by the citation kind they require. */
function designWorkItemKind(type: string): 'MOCKUP' | 'DIAGRAM' | undefined {
  if (type === MOCKUP_TYPE) return 'MOCKUP';
  if (canonicalDiagramType(type) === 'DIAGRAM') return 'DIAGRAM';
  return undefined;
}

/** A cited entity as loaded, regardless of project. */
export type FeatureRequirementCitationTarget = {
  entityType: 'TASK' | 'DESIGN_DOC';
  projectId: string;
  type?: string;
};

type DraftCitation = {
  entityType: string;
  entityId: string;
  entityTitle?: string;
};

@Injectable()
export class FeatureRequirementAuthoringService {
  private readonly logger = new Logger(FeatureRequirementAuthoringService.name);

  constructor(private readonly registry: WorkItemTypeRegistryService) {}

  /**
   * Turn the create-time input into the one section representation that is
   * reviewed and persisted. IDs are allocated here, before proposal creation,
   * and the resulting collection is returned to callers for reuse verbatim.
   */
  async prepareInitialRequirements(
    inputs: readonly FeatureRequirementInput[],
    context: FeatureRequirementTitleContext,
    mintUuid: () => string = randomUUID,
  ): Promise<FeatureRequirementPreparationResult> {
    const parsed = featureRequirementInputSchema.array().safeParse(inputs);
    if (!parsed.success) {
      return {
        success: false,
        diagnostics: zodDiagnostics('initialRequirements', parsed.error),
      };
    }

    const mintedRequirementIds: Record<string, string> = {};
    const records: FeatureRequirementDraftRecord[] = parsed.data.map(
      (input) => {
        const id = mintUuid();
        mintedRequirementIds[id] = input.statement;
        return {
          id,
          statement: input.statement,
          ...(input.group !== undefined ? { group: input.group } : {}),
          designedBy: [...(input.designedBy ?? [])],
          fulfilledBy: [...(input.fulfilledBy ?? [])],
          contracts: [...(input.contracts ?? [])],
        };
      },
    );

    return this.preparedSectionResult(
      { records },
      mintedRequirementIds,
      'initialRequirements',
      context,
    );
  }

  /**
   * Apply ordered edit operations to the reviewed JSON collection. Add IDs
   * are minted exactly once here; later operations in the same batch address
   * those IDs, and the complete resulting collection is what callers persist.
   */
  async prepareRequirementOperations(
    currentSection: unknown,
    operations: readonly FeatureRequirementOperation[],
    context: FeatureRequirementTitleContext,
    mintUuid: () => string = randomUUID,
  ): Promise<FeatureRequirementPreparationResult> {
    const current = validateFeatureRequirementsSection(currentSection);
    if (!current.success) {
      return {
        success: false,
        diagnostics: [
          {
            field: 'requirements',
            code: 'invalid_structure',
            message: current.message,
          },
        ],
      };
    }

    const parsed = featureRequirementOperationSchema
      .array()
      .safeParse(operations);
    if (!parsed.success) {
      return {
        success: false,
        diagnostics: zodDiagnostics('requirementOps', parsed.error),
      };
    }

    const prepared = prepareFeatureRequirementOperations(parsed.data, mintUuid);
    const applied = applyFeatureRequirementOperations(
      current.value.records,
      prepared,
    );
    if (applied.issues.length > 0) {
      return {
        success: false,
        diagnostics: applied.issues.map((item) => ({
          field:
            item.operationIndex < parsed.data.length
              ? `requirementOps[${item.operationIndex}].${item.field}`
              : 'requirementOps',
          code: 'invalid_operation',
          message: item.message,
        })),
      };
    }

    const mintedRequirementIds: Record<string, string> = {};
    prepared.forEach((operation) => {
      if (operation.op === 'add') {
        mintedRequirementIds[operation.id] = operation.value.statement;
      }
    });
    return this.preparedSectionResult(
      { records: applied.records },
      mintedRequirementIds,
      'requirementOps',
      context,
    );
  }

  /**
   * Snapshot the cited entity's title onto every citation that does not yet
   * carry one, in one EntityRegistry batch. Titles already stored are kept as
   * written: a later rename of the cited entity never rewrites them.
   */
  async resolveCitationTitles(
    section: FeatureRequirementsDraftSection,
    context: FeatureRequirementTitleContext,
  ): Promise<FeatureRequirementTitleResolutionResult> {
    const untitled = section.records.flatMap((record) =>
      CITATION_SLOTS.flatMap((slot) =>
        (record[slot] as readonly DraftCitation[])
          .filter((citation) => citation.entityTitle === undefined)
          .map((citation) => ({
            entityId: citation.entityId,
            entityType: registryEntityType(citation.entityType),
            needsTitle: true,
          })),
      ),
    );
    const metadata = untitled.length
      ? await loadProposalReferenceMetadata(
          context.db,
          context.organizationId as OrganizationId,
          untitled,
        )
      : undefined;

    const diagnostics: FeatureRequirementDiagnostic[] = [];
    const titleFor = (
      citation: DraftCitation,
      recordIndex: number,
      field: string,
    ): string => {
      if (citation.entityTitle !== undefined) return citation.entityTitle;
      const row = metadata?.registryRows.get(
        `${citation.entityId}:${registryEntityType(citation.entityType)}`,
      );
      if (!row || row.deletedAt || row.entityName === null) {
        diagnostics.push(
          issue(
            recordIndex,
            field,
            'entity_not_found',
            `${citation.entityType} was not found in the organization.`,
          ),
        );
        return '';
      }
      return row.entityName;
    };

    const records: FeatureRequirementRecord[] = section.records.map(
      (record, recordIndex) => ({
        ...record,
        designedBy: record.designedBy.map((citation, index) => ({
          ...citation,
          entityTitle: titleFor(
            citation,
            recordIndex,
            `records[${recordIndex}].designedBy[${index}]`,
          ),
        })),
        fulfilledBy: record.fulfilledBy.map((citation, index) => ({
          ...citation,
          entityTitle: titleFor(
            citation,
            recordIndex,
            `records[${recordIndex}].fulfilledBy[${index}]`,
          ),
        })),
        contracts: record.contracts.map((citation, index) => ({
          ...citation,
          entityTitle: titleFor(
            citation,
            recordIndex,
            `records[${recordIndex}].contracts[${index}]`,
          ),
        })),
      }),
    );

    if (diagnostics.length) {
      this.logger.warn('Feature requirement citation titles unresolved', {
        organizationId: context.organizationId,
        unresolved: diagnostics.length,
      });
      return { success: false, diagnostics };
    }
    this.logger.debug('Resolved feature requirement citation titles', {
      organizationId: context.organizationId,
      resolved: untitled.length,
    });
    return { success: true, section: { records } };
  }

  async validate(
    section: unknown,
    context: {
      organizationId: string;
      projectId: string;
      workItemId?: string;
      effectiveParentId?: string;
      db: AnyTransactionClient;
    },
  ): Promise<FeatureRequirementAuthoringResult> {
    const structural = validateFeatureRequirementsSection(section);
    if (!structural.success) {
      return {
        success: false,
        diagnostics: [
          {
            field: 'requirements',
            code: 'invalid_structure',
            message: structural.message,
          },
        ],
      };
    }

    const warnings = structural.warnings.map((message) => ({
      field: message.split(' ')[0]!,
      code: 'uncited_requirement',
      message,
    }));
    const taskIds = new Set<string>();
    const designDocIds = new Set<string>();
    structural.value.records.forEach((record) => {
      record.designedBy.forEach(({ entityType, entityId }) =>
        (entityType === 'DESIGN_DOC' ? designDocIds : taskIds).add(entityId),
      );
      record.fulfilledBy.forEach(({ entityId }) => taskIds.add(entityId));
      record.contracts.forEach(({ entityId }) => taskIds.add(entityId));
    });

    const [tasks, designDocs] = await Promise.all([
      taskIds.size
        ? context.db.task.findMany({
            where: {
              id: { in: [...taskIds] },
              organizationId: context.organizationId,
              archivedAt: null,
            },
            select: { id: true, projectId: true, type: true },
          })
        : [],
      designDocIds.size
        ? context.db.designDoc.findMany({
            where: {
              id: { in: [...designDocIds] },
              organizationId: context.organizationId,
              archivedAt: null,
            },
            select: { id: true, projectId: true },
          })
        : [],
    ]);
    const citations = new Map<string, FeatureRequirementCitationTarget>();
    tasks.forEach((task: { id: string; projectId: string; type: string }) =>
      citations.set(task.id, {
        entityType: 'TASK',
        projectId: task.projectId,
        type: task.type,
      }),
    );
    designDocs.forEach((doc: { id: string; projectId: string }) =>
      citations.set(doc.id, {
        entityType: 'DESIGN_DOC',
        projectId: doc.projectId,
      }),
    );

    const diagnostics = this.checkCitations(structural.value, {
      projectId: context.projectId,
      excluded: new Set(
        [context.workItemId, context.effectiveParentId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
      citations,
    });
    return diagnostics.length
      ? { success: false, diagnostics }
      : { success: true, section: structural.value, warnings };
  }

  /**
   * Checks a structurally valid section against already-loaded citation
   * targets, so callers that load citations themselves never query here.
   */
  checkCitations(
    section: FeatureRequirementsSection,
    context: {
      projectId: string;
      excluded: ReadonlySet<string>;
      citations: ReadonlyMap<string, FeatureRequirementCitationTarget>;
    },
  ): FeatureRequirementDiagnostic[] {
    const diagnostics: FeatureRequirementDiagnostic[] = [];
    const tasksById = new Map<
      string,
      { id: string; projectId: string; type: string }
    >();
    const docsById = new Map<string, { projectId: string }>();
    context.citations.forEach((target, id) => {
      if (target.entityType === 'DESIGN_DOC')
        docsById.set(id, { projectId: target.projectId });
      else
        tasksById.set(id, {
          id,
          projectId: target.projectId,
          type: target.type ?? '',
        });
    });

    section.records.forEach((record, recordIndex) => {
      record.designedBy.forEach((citation, citationIndex) => {
        const field = `records[${recordIndex}].designedBy[${citationIndex}]`;
        if (citation.entityType !== 'DESIGN_DOC') {
          const kind = citation.entityType;
          const task = tasksById.get(citation.entityId);
          if (!task)
            diagnostics.push(
              issue(
                recordIndex,
                field,
                'entity_not_found',
                `${kind} was not found in the organization.`,
              ),
            );
          else if (task.projectId !== context.projectId)
            diagnostics.push(
              issue(
                recordIndex,
                field,
                'foreign_project',
                `${kind} belongs to another project.`,
              ),
            );
          else if (designWorkItemKind(task.type) !== kind)
            diagnostics.push(
              issue(
                recordIndex,
                field,
                'wrong_type',
                `${kind} citation requires an actual ${kind.toLowerCase()}; found ${task.type}.`,
              ),
            );
          return;
        }
        const doc = docsById.get(citation.entityId);
        if (!doc)
          diagnostics.push(
            issue(
              recordIndex,
              field,
              'entity_not_found',
              'DESIGN_DOC was not found in the organization.',
            ),
          );
        else if (doc.projectId !== context.projectId)
          diagnostics.push(
            issue(
              recordIndex,
              field,
              'foreign_project',
              'DESIGN_DOC belongs to another project.',
            ),
          );
      });
      this.validateTaskSlot(
        record,
        recordIndex,
        'fulfilledBy',
        tasksById,
        context.excluded,
        context.projectId,
        diagnostics,
      );
      this.validateTaskSlot(
        record,
        recordIndex,
        'contracts',
        tasksById,
        context.excluded,
        context.projectId,
        diagnostics,
      );
    });
    return diagnostics;
  }

  private async preparedSectionResult(
    draft: FeatureRequirementsDraftSection,
    mintedRequirementIds: Record<string, string>,
    field: string,
    context: FeatureRequirementTitleContext,
  ): Promise<FeatureRequirementPreparationResult> {
    const draftStructural = validateFeatureRequirementsDraft(draft);
    if (!draftStructural.success) {
      return {
        success: false,
        diagnostics: [
          {
            field,
            code: 'invalid_structure',
            message: draftStructural.message,
          },
        ],
      };
    }
    const titled = await this.resolveCitationTitles(
      draftStructural.value,
      context,
    );
    if (!titled.success) {
      return {
        success: false,
        diagnostics: titled.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          field: `${field}.${diagnostic.field}`,
        })),
      };
    }
    const structural = validateFeatureRequirementsSection(titled.section);
    if (!structural.success) {
      return {
        success: false,
        diagnostics: [
          {
            field,
            code: 'invalid_structure',
            message: structural.message,
          },
        ],
      };
    }
    return {
      success: true,
      section: structural.value,
      mintedRequirementIds,
      warnings: structural.warnings.map((message) => {
        const match = /^\/records\/(\d+)/.exec(message);
        const recordIndex = match ? Number(match[1]) : undefined;
        return {
          ...(recordIndex === undefined ? {} : { recordIndex }),
          field: recordIndex === undefined ? field : `records[${recordIndex}]`,
          code: 'uncited_requirement',
          message,
        };
      }),
    };
  }

  private validateTaskSlot(
    record: FeatureRequirementRecord,
    recordIndex: number,
    slot: 'fulfilledBy' | 'contracts',
    tasks: Map<string, { id: string; projectId: string; type: string }>,
    excluded: ReadonlySet<string>,
    projectId: string,
    diagnostics: FeatureRequirementDiagnostic[],
  ): void {
    record[slot].forEach((citation, citationIndex) => {
      const field = `records[${recordIndex}].${slot}[${citationIndex}]`;
      const task = tasks.get(citation.entityId);
      if (!task)
        return diagnostics.push(
          issue(
            recordIndex,
            field,
            'entity_not_found',
            `${citation.entityType} was not found in the organization.`,
          ),
        );
      if (task.projectId !== projectId)
        return diagnostics.push(
          issue(
            recordIndex,
            field,
            'foreign_project',
            `${citation.entityType} belongs to another project.`,
          ),
        );
      if (excluded.has(task.id))
        return diagnostics.push(
          issue(
            recordIndex,
            field,
            'excluded_reference',
            'A requirement cannot cite itself or its effective parent.',
          ),
        );
      if (slot === 'contracts' && task.type !== 'CONTRACT') {
        return diagnostics.push(
          issue(
            recordIndex,
            field,
            'wrong_type',
            `contracts requires a CONTRACT work item; found ${task.type}.`,
          ),
        );
      }
      if (slot === 'fulfilledBy') {
        if (citation.entityType === 'PLAN' && task.type !== 'PLAN') {
          return diagnostics.push(
            issue(
              recordIndex,
              field,
              'wrong_type',
              `PLAN citation requires an actual PLAN; found ${task.type}.`,
            ),
          );
        }
        if (citation.entityType === 'TASK' && task.type === 'PLAN') {
          return diagnostics.push(
            issue(
              recordIndex,
              field,
              'wrong_type',
              'PLAN work items must be cited as PLAN, never coerced to TASK.',
            ),
          );
        }
        if (task.type === 'CONTRACT') {
          return diagnostics.push(
            issue(
              recordIndex,
              field,
              'wrong_slot',
              'CONTRACT work items belong in contracts, not fulfilledBy.',
            ),
          );
        }
        const designKind = designWorkItemKind(task.type);
        if (designKind) {
          return diagnostics.push(
            issue(
              recordIndex,
              field,
              'wrong_slot',
              `${designKind} work items belong in designedBy, not fulfilledBy.`,
            ),
          );
        }
        const rules = this.registry.getRulesForProject(task.type, projectId);
        if (
          task.type !== 'PLAN' &&
          task.type !== 'FEATURE' &&
          canonicalDiagramType(task.type) !== 'DIAGRAM_ELEMENT' &&
          (!rules || rules.role !== 'work-item')
        ) {
          diagnostics.push(
            issue(
              recordIndex,
              field,
              'ineligible_type',
              `${task.type} is not an eligible fulfillment work item.`,
            ),
          );
        }
      }
    });
  }
}

// Every work-item citation kind (TASK, PLAN, CONTRACT, MOCKUP, DIAGRAM) is registered as TASK.
function registryEntityType(entityType: string): string {
  return entityType === 'DESIGN_DOC' ? 'DESIGN_DOC' : 'TASK';
}

function issue(
  recordIndex: number,
  field: string,
  code: string,
  message: string,
): FeatureRequirementDiagnostic {
  return { recordIndex, field, code, message };
}

function zodDiagnostics(
  field: string,
  error: {
    issues: readonly { path: readonly (string | number)[]; message: string }[];
  },
): FeatureRequirementDiagnostic[] {
  return error.issues.map((item) => ({
    field: `${field}${item.path.length ? `.${item.path.join('.')}` : ''}`,
    code: 'invalid_input',
    message: item.message,
  }));
}
