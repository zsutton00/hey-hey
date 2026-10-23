import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { isEqual } from 'lodash';
import type {
  FutureApplyConfirmation,
  FutureApplyRequest,
  FutureApplyResponse,
  FutureRevisionResponse,
  UpdateDesignDocDto,
  UpdateTaskDto,
} from 'src/generated';
import { futureApplyRequestSchema } from 'src/generated/future-revision.schema';
import type { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { resolveWorkItemSectionContentKind } from '../tasks/task-section-schema-validator.registry';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from './proposal-visibility';
import type { ProposalReconciliationService } from './proposal-reconciliation.service';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile<FutureApplyRequest>(futureApplyRequestSchema);

export function parseFutureApplyRequest(input: unknown): FutureApplyRequest {
  if (!validate(input)) {
    throw new BadRequestException({
      message: 'Apply request violates the OpenAPI contract',
      errors: validate.errors,
    });
  }
  return input;
}

export async function readFutureApplyConfirmation(
  db: Prisma.TransactionClient,
  future: FutureRevisionResponse,
): Promise<FutureApplyConfirmation> {
  const refinements = await db.proposal.findMany({
    where: {
      organizationId: future.organizationId,
      projectId: future.projectId,
      targetEntityType: future.targetEntityType,
      targetEntityId: future.targetEntityId,
      action: 'VERSIONED_UPDATE',
      status: 'DRAFT',
      updates: { path: ['futureId'], equals: future.id },
      ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
    },
    select: { id: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  return {
    revision: future.revision,
    refinements: refinements.map((entry) => ({
      proposalId: entry.id,
      updatedAt: entry.updatedAt.toISOString(),
    })),
  };
}

export function matchesFutureConfirmation(
  supplied: FutureApplyConfirmation | undefined,
  current: FutureApplyConfirmation,
): boolean {
  if (
    !supplied ||
    supplied.revision !== current.revision ||
    supplied.refinements.length !== current.refinements.length
  )
    return false;
  const versions = new Map(
    supplied.refinements.map((entry) => [entry.proposalId, entry.updatedAt]),
  );
  return (
    versions.size === current.refinements.length &&
    current.refinements.every(
      (entry) => versions.get(entry.proposalId) === entry.updatedAt,
    )
  );
}

export function sectionContent(
  value: string,
  key: string,
  future: Pick<FutureRevisionResponse, 'result' | 'projectId'>,
  registry: WorkItemTypeRegistryService,
): unknown {
  if (!('type' in future.result)) return value;
  const definition = registry
    .getSectionDefinitions(future.result.type, future.projectId)
    .find((section) => section.key === key);
  // Task reads project an unset structured section as an empty string.
  // Preserve that representation when comparing complete future snapshots.
  if (value === '' || !definition) return value;
  return resolveWorkItemSectionContentKind(definition) !== 'markdown'
    ? JSON.parse(value)
    : value;
}

/** Compare the selected content basis, not response metadata or a new version token. */
export async function futureBaselineBlocker(
  db: Prisma.TransactionClient,
  future: FutureRevisionResponse,
  reconciliation: ProposalReconciliationService,
): Promise<FutureApplyResponse['blocker'] | undefined> {
  if (future.baseline.kind === 'FUTURE') {
    const parent = await db.proposalFuture.findFirst({
      where: {
        id: future.baseline.futureId,
        organizationId: future.organizationId,
        projectId: future.projectId,
        targetEntityId: future.targetEntityId,
        targetEntityType: future.targetEntityType,
      },
    });
    if (
      !parent ||
      parent.outcome !== 'APPLIED' ||
      String(parent.appliedRevision) !== future.baseline.revision
    )
      return 'BASELINE_UNAVAILABLE';
  }
  const where = {
    id: future.targetEntityId,
    organizationId: future.organizationId,
    projectId: future.projectId,
  };
  const target =
    future.targetEntityType === 'TASK'
      ? await db.task.findFirst({ where, select: { id: true, archivedAt: true } })
      : await db.designDoc.findFirst({
          where,
          select: { id: true, archivedAt: true },
        });
  if (!target || target.archivedAt) return 'BASELINE_UNAVAILABLE';
  return (await reconciliation.futureBaselineChanged(
    db,
    {
      organizationId: future.organizationId,
      projectId: future.projectId,
      targetEntityType: future.targetEntityType,
      targetEntityId: future.targetEntityId,
    },
    future.baseline,
  ))
    ? 'BASELINE_CHANGED'
    : undefined;
}

/** Adapt the reviewed result to the existing generated target update contract. */
export function futureTargetUpdates(
  future: FutureRevisionResponse,
  registry: WorkItemTypeRegistryService,
): UpdateTaskDto | UpdateDesignDocDto {
  const result = future.result;
  if ('type' in result) {
    return {
      name: result.name,
      priority: result.priority,
      tag: result.tag,
      initiativeId: result.initiativeId,
      parentTaskId: result.parentTaskId ?? null,
      assigneeId: result.assigneeId ?? null,
      dueDate: result.dueDate ?? null,
      sections: result.sections
        .filter((section) => {
          const baseline = future.baseline.content.sections.find(
            (candidate) => candidate.key === section.key,
          );
          return (
            !baseline ||
            !isEqual(
              sectionContent(
                baseline.materializedMarkdown,
                section.key,
                future,
                registry,
              ),
              sectionContent(
                section.materializedMarkdown,
                section.key,
                future,
                registry,
              ),
            )
          );
        })
        .map((section) => ({
          key: section.key,
          order: section.order,
          content: sectionContent(
            section.materializedMarkdown,
            section.key,
            future,
            registry,
          ),
        })),
    } satisfies UpdateTaskDto;
  }
  return {
    name: result.name,
    template: result.template,
    tags: result.tags,
    summary: result.summary ?? null,
    parentEntityId: result.parentEntityId ?? null,
    parentEntityType: result.parentEntityType ?? null,
    sections: result.sections.map((section) => ({
      id: section.id,
      key: section.key,
      order: section.order,
      content: section.materializedMarkdown,
    })),
  } satisfies UpdateDesignDocDto;
}
