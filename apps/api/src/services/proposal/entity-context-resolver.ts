import { NotFoundException } from '@nestjs/common';
import { isEqual } from 'lodash';
import type {
  FutureRevisionBaseline,
  FutureRevisionContent,
  FutureRevisionContentOneOf,
  FutureRevisionMutation,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { sectionContent } from './future-application';
import type { EntityContext } from './permission-evaluation';
import {
  isWorkItemChangeSetValidationRequest,
  proposalWriteFacts,
} from './task-proposal-change-set-conversion';

export interface EntityContextInput {
  targetEntityType: string;
  action: string;
  targetEntityId: string;
  updates: unknown;
}

/**
 * Build an EntityContext for permission evaluation from either a persisted
 * Proposal or a not-yet-persisted CreateProposalDto. The two callers (create
 * and approve) must produce the same EntityContext for the same target so
 * the apply-on-create branch and the approve branch agree on threshold.
 */
export async function resolveEntityContext(
  tx: AnyTransactionClient,
  input: EntityContextInput,
): Promise<EntityContext> {
  if (input.targetEntityType === 'TASK' && input.action !== 'CREATE') {
    const task = await tx.task.findFirst({
      where: { id: input.targetEntityId },
      select: { type: true, parentTaskId: true, initiativeId: true },
    });
    if (!task) {
      throw new NotFoundException(
        `Target task not found: ${input.targetEntityId}`,
      );
    }
    return {
      type: task.type,
      parentTaskId: task.parentTaskId,
      initiativeId: task.initiativeId ?? null,
    };
  }

  if (input.targetEntityType === 'TASK' && input.action === 'CREATE') {
    if (isWorkItemChangeSetValidationRequest(input.updates)) {
      const root = input.updates.root;
      const create = input.updates.operations.find(
        (operation) =>
          operation.op === 'workItem.create' &&
          root.refType === 'temporary' &&
          operation.ref.tempId === root.tempId,
      );
      if (create?.op === 'workItem.create') {
        return {
          type: create.type ?? 'STANDARD',
          parentTaskId:
            create.parent === undefined
              ? null
              : create.parent.refType === 'existing'
                ? create.parent.id
                : create.parent.tempId,
          initiativeId: null,
        };
      }
    }
    const updates = (input.updates ?? {}) as Record<string, unknown>;
    return {
      type: (updates.type as string) ?? 'TASK',
      parentTaskId: (updates.parentTaskId as string | null) ?? null,
      initiativeId: (updates.initiativeId as string | null) ?? null,
    };
  }

  return {
    type: input.targetEntityType,
    parentTaskId: null,
    initiativeId: null,
  };
}

/**
 * Derive the canonical changed-field paths used by permission evaluation.
 * Ordinary proposals consume the conversion's write facts, never DTO field
 * rules. Task futures derive them from the complete baseline/result pair so
 * review and Apply use the same approval policy for the content the future
 * carries; future status is excluded because Apply does not write it.
 */
const TASK_SCALAR_FIELDS = [
  'name',
  'status',
  'priority',
  'assigneeId',
  'dueDate',
  'parentTaskId',
  'initiativeId',
  'type',
] as const;
type TaskScalarField = (typeof TASK_SCALAR_FIELDS)[number];

interface ChangedFieldResolutionContext {
  organizationId: string;
  projectId: string;
  workItemTypeRegistry?: WorkItemTypeRegistryService;
  future?: { baseline: FutureRevisionBaseline; result: FutureRevisionContent };
}

function taskScalarValue(
  content: FutureRevisionContentOneOf,
  field: TaskScalarField,
): unknown {
  switch (field) {
    case 'name':
      return content.name;
    case 'status':
      return content.status;
    case 'priority':
      return content.priority;
    case 'assigneeId':
      return content.assigneeId;
    case 'dueDate':
      return content.dueDate;
    case 'parentTaskId':
      return content.parentTaskId;
    case 'initiativeId':
      return content.initiativeId;
    case 'type':
      return content.type;
  }
}

function deriveTaskFutureChangedFields(
  baseline: FutureRevisionContentOneOf,
  result: FutureRevisionContentOneOf,
  projectId: string,
  registry: WorkItemTypeRegistryService | undefined,
): string[] {
  const changedFields: string[] = TASK_SCALAR_FIELDS.filter(
    (key) =>
      key !== 'status' &&
      !isEqual(
        taskScalarValue(baseline, key) ?? null,
        taskScalarValue(result, key) ?? null,
      ),
  );

  const baselineSections = new Map(
    baseline.sections.map((section) => [section.key, section]),
  );
  const resultSections = new Map(
    result.sections.map((section) => [section.key, section]),
  );
  const sectionKeys = new Set([
    ...baselineSections.keys(),
    ...resultSections.keys(),
  ]);
  const future = { result, projectId };

  for (const key of sectionKeys) {
    const before = baselineSections.get(key);
    const after = resultSections.get(key);
    if (!before || !after) {
      changedFields.push(`sections.${key}`);
      continue;
    }
    if (before.materializedMarkdown === after.materializedMarkdown) continue;
    if (!registry) {
      throw new Error(
        'Task future section comparison requires the work-item type registry',
      );
    }
    if (
      !isEqual(
        sectionContent(before.materializedMarkdown, key, future, registry),
        sectionContent(after.materializedMarkdown, key, future, registry),
      )
    ) {
      changedFields.push(`sections.${key}`);
    }
  }

  return changedFields;
}

export async function deriveChangedFields(
  tx: AnyTransactionClient,
  input: EntityContextInput,
  context?: ChangedFieldResolutionContext,
): Promise<string[]> {
  if (
    input.action === 'VERSIONED_UPDATE' &&
    input.targetEntityType === 'TASK'
  ) {
    if (!context) {
      throw new Error(
        'Task future field derivation requires its organization and project context',
      );
    }
    const mutation = input.updates as FutureRevisionMutation;
    let baseline: FutureRevisionContent;
    let result: FutureRevisionContent;
    if (mutation.operation === 'REVISE') {
      baseline = mutation.baseline.content;
      result = mutation.result;
    } else {
      const future =
        context.future ??
        (await tx.proposalFuture.findFirst({
          where: {
            id: mutation.futureId,
            organizationId: context.organizationId,
            projectId: context.projectId,
            targetEntityId: input.targetEntityId,
            targetEntityType: 'TASK',
          },
          select: { baseline: true, result: true },
        }));
      if (!future) {
        throw new NotFoundException(
          `Task future not found for changed-field resolution: ${mutation.futureId}`,
        );
      }
      baseline = (future.baseline as unknown as FutureRevisionBaseline).content;
      result = future.result as unknown as FutureRevisionContent;
    }
    return deriveTaskFutureChangedFields(
      baseline as FutureRevisionContentOneOf,
      result as FutureRevisionContentOneOf,
      context.projectId,
      context.workItemTypeRegistry,
    );
  }
  const facts = proposalWriteFacts(input);
  return [
    ...facts.fieldUpdates,
    ...facts.sectionWrites.map((key) => `sections.${key}`),
  ];
}
