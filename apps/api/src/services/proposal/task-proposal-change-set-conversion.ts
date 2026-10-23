import type {
  CreateTaskDto,
  TaskSectionInput,
  UpdateTaskDto,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetValidationRequest,
  WorkItemCreateOperation,
  WorkItemUpdateOperation,
} from 'src/generated';
import { canonicalDiagramType } from '../tasks/diagram-metadata';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';

export interface ProposalWriteInput {
  targetEntityType: string;
  action: string;
  updates: unknown;
}

export interface ProposalWriteFacts {
  fieldUpdates: string[];
  sectionWrites: string[];
  /** Content must be prepared before these writes can become graph operations. */
  hasUnpreparedRequirements: boolean;
}

export function isWorkItemChangeSetValidationRequest(
  value: unknown,
): value is WorkItemChangeSetValidationRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    'root' in value &&
    Array.isArray((value as { operations?: unknown }).operations)
  );
}

/** Requirement authoring is a section write, even before its content is prepared. */
export function taskRequirementSectionWrite(
  action: string,
  updates: Record<string, unknown>,
): boolean {
  return action === 'CREATE'
    ? updates.type === WORK_ITEM_TYPE_KEYS.Feature &&
        updates.initialRequirements !== undefined
    : action === 'UPDATE' &&
        Array.isArray(updates.requirementOps) &&
        updates.requirementOps.length > 0;
}

/** Pure field conversion shared by materialization and write-intent derivation. */
export function taskCreateOperation(
  updates: CreateTaskDto,
  ref: WorkItemCreateOperation['ref'],
): WorkItemCreateOperation {
  return {
    op: 'workItem.create',
    ref,
    name: updates.name,
    ...(updates.type !== undefined
      ? { type: canonicalDiagramType(updates.type) }
      : {}),
    ...(updates.parentTaskId !== undefined
      ? {
          parent:
            updates.parentTaskId === null
              ? undefined
              : { refType: 'existing' as const, id: updates.parentTaskId },
        }
      : {}),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
    ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
    ...(updates.dueDate !== undefined ? { dueDate: updates.dueDate } : {}),
    ...(updates.assigneeId !== undefined
      ? { assigneeId: updates.assigneeId }
      : {}),
    ...(updates.tag !== undefined ? { tag: updates.tag } : {}),
  } satisfies WorkItemCreateOperation;
}

export function taskUpdateOperation(
  updates: UpdateTaskDto,
  ref: WorkItemChangeSetIdentity,
): WorkItemUpdateOperation {
  const operation: WorkItemUpdateOperation = { op: 'workItem.update', ref };
  if (Object.prototype.hasOwnProperty.call(updates, 'name'))
    operation.name = updates.name;
  if (Object.prototype.hasOwnProperty.call(updates, 'parentTaskId'))
    operation.parent = updates.parentTaskId
      ? { refType: 'existing', id: updates.parentTaskId }
      : null;
  if (Object.prototype.hasOwnProperty.call(updates, 'status'))
    operation.status = updates.status;
  if (Object.prototype.hasOwnProperty.call(updates, 'priority'))
    operation.priority = updates.priority;
  if (Object.prototype.hasOwnProperty.call(updates, 'dueDate'))
    operation.dueDate = updates.dueDate ?? null;
  if (Object.prototype.hasOwnProperty.call(updates, 'assigneeId'))
    operation.assigneeId = updates.assigneeId ?? null;
  if (Object.prototype.hasOwnProperty.call(updates, 'tag'))
    operation.tag = updates.tag;
  return operation;
}

function sameWorkItem(
  left: WorkItemChangeSetIdentity,
  right: WorkItemChangeSetIdentity,
): boolean {
  return left.refType === 'existing'
    ? right.refType === 'existing' && left.id === right.id
    : right.refType === 'temporary' && left.tempId === right.tempId;
}

function operationFieldWrites(
  operation: WorkItemCreateOperation | WorkItemUpdateOperation,
): string[] {
  return Object.keys(operation)
    .filter((key) => key !== 'op' && key !== 'ref')
    .map((key) => (key === 'parent' ? 'parentTaskId' : key));
}

/**
 * Describe writes without preparing content or reading the database. Ordinary
 * edge enactment does not affect these facts: an untranslatable relationship
 * never erases the task's field or section writes.
 */
export function proposalWriteFacts(
  input: ProposalWriteInput,
): ProposalWriteFacts {
  const updates = (input.updates ?? {}) as Record<string, unknown>;
  const hasUnpreparedRequirements =
    Object.prototype.hasOwnProperty.call(updates, 'initialRequirements') ||
    Object.prototype.hasOwnProperty.call(updates, 'requirementOps');
  if (
    input.targetEntityType !== 'TASK' ||
    (input.action !== 'CREATE' && input.action !== 'UPDATE')
  ) {
    return {
      fieldUpdates: [],
      sectionWrites: [],
      hasUnpreparedRequirements,
    };
  }
  const fieldUpdates = new Set<string>();
  const sectionWrites = new Set<string>();
  if (isWorkItemChangeSetValidationRequest(input.updates)) {
    const request = input.updates;
    for (const operation of request.operations) {
      switch (operation.op) {
        case 'workItem.create':
        case 'workItem.update':
          if (sameWorkItem(operation.ref, request.root)) {
            operationFieldWrites(operation).forEach((key) =>
              fieldUpdates.add(key),
            );
          }
          break;
        case 'section.replace':
        case 'section.clear':
          if (sameWorkItem(operation.ref, request.root))
            sectionWrites.add(operation.key);
          break;
      }
    }
  } else {
    const operation =
      input.action === 'CREATE'
        ? taskCreateOperation(updates as unknown as CreateTaskDto, {
            refType: 'temporary',
            tempId: 'root',
          })
        : taskUpdateOperation(updates as unknown as UpdateTaskDto, {
            refType: 'temporary',
            tempId: 'root',
          });
    operationFieldWrites(operation)
      .filter((key) => updates[key] !== undefined)
      .forEach((key) => fieldUpdates.add(key));
    // Ordinary fields retained on the proposal row are merged at materialization;
    // service assignments are attached alongside the normalized field operation.
    for (const key of ['initiativeId', 'type', 'serviceIds']) {
      if (updates[key] !== undefined) fieldUpdates.add(key);
    }
    if (input.action === 'CREATE') {
      for (const key of ['source', 'config', 'serviceId']) {
        if (updates[key] !== undefined) fieldUpdates.add(key);
      }
    }
    if (Array.isArray(updates.sections)) {
      for (const section of updates.sections as TaskSectionInput[]) {
        if (section && typeof section.key === 'string')
          sectionWrites.add(section.key);
      }
    }
    if (taskRequirementSectionWrite(input.action, updates))
      sectionWrites.add('requirements');
  }
  return {
    fieldUpdates: [...fieldUpdates],
    sectionWrites: [...sectionWrites],
    hasUnpreparedRequirements,
  };
}
