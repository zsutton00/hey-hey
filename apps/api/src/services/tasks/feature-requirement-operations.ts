import { randomUUID } from 'crypto';
import type {
  FeatureRequirementCitation,
  FeatureRequirementInput,
  FeatureRequirementOperation,
} from '../../generated';
import {
  type FeatureRequirementDraftRecord,
  validateFeatureRequirementsDraft,
} from './feature-requirements-section.validator';

export interface PreparedFeatureRequirementAddOperation {
  op: 'add';
  id: string;
  value: FeatureRequirementInput;
  before?: string;
}

export type PreparedFeatureRequirementOperation =
  | PreparedFeatureRequirementAddOperation
  | Exclude<FeatureRequirementOperation, { op: 'add' }>;

export interface FeatureRequirementOperationIssue {
  operationIndex: number;
  field: string;
  message: string;
}

export function prepareFeatureRequirementOperations(
  operations: readonly FeatureRequirementOperation[],
  mintUuid: () => string = randomUUID,
): PreparedFeatureRequirementOperation[] {
  return operations.map((operation) =>
    operation.op === 'add' ? { ...operation, id: mintUuid() } : operation,
  );
}

export function applyFeatureRequirementOperations(
  current: readonly FeatureRequirementDraftRecord[],
  operations: readonly PreparedFeatureRequirementOperation[],
): {
  records: FeatureRequirementDraftRecord[];
  issues: FeatureRequirementOperationIssue[];
} {
  const originalRecords = current.map(cloneRecord);
  const records = originalRecords.map(cloneRecord);
  const issues: FeatureRequirementOperationIssue[] = [];

  operations.forEach((operation, operationIndex) => {
    if (operation.op === 'add') {
      const record: FeatureRequirementDraftRecord = {
        id: operation.id,
        statement: operation.value.statement,
        ...(operation.value.group !== undefined
          ? { group: operation.value.group }
          : {}),
        designedBy: [...(operation.value.designedBy ?? [])],
        fulfilledBy: [...(operation.value.fulfilledBy ?? [])],
        contracts: [...(operation.value.contracts ?? [])],
      };
      const beforeIndex = operation.before
        ? records.findIndex(({ id }) => id === operation.before)
        : -1;
      if (beforeIndex === -1) records.push(record);
      else records.splice(beforeIndex, 0, record);
      return;
    }

    const targetIndex = records.findIndex(
      ({ id }) => id === operation.targetId,
    );
    if (targetIndex === -1) {
      issues.push({
        operationIndex,
        field: 'targetId',
        message: `Requirement '${operation.targetId}' does not exist at this point in the batch.`,
      });
      return;
    }
    if (operation.op === 'delete') {
      records.splice(targetIndex, 1);
      return;
    }

    const existing = records[targetIndex]!;
    const group =
      operation.group === undefined
        ? existing.group
        : (operation.group ?? undefined);
    records[targetIndex] = {
      id: existing.id,
      statement: operation.statement ?? existing.statement,
      ...(group !== undefined ? { group } : {}),
      designedBy: patchCitations(existing.designedBy, operation.designedBy),
      fulfilledBy: patchCitations(existing.fulfilledBy, operation.fulfilledBy),
      contracts: patchCitations(existing.contracts, operation.contracts),
    };
  });

  if (issues.length === 0) {
    const validation = validateFeatureRequirementsDraft({ records });
    if (!validation.success) {
      issues.push({
        operationIndex: operations.length,
        field: 'records',
        message: validation.message,
      });
    }
  }
  return {
    records: issues.length === 0 ? records : originalRecords,
    issues,
  };
}

function patchCitations<T extends FeatureRequirementCitation>(
  current: readonly T[],
  patch: { add?: readonly T[]; remove?: readonly T[] } | undefined,
): T[] {
  if (!patch) return [...current];
  const removed = new Set((patch.remove ?? []).map(citationKey));
  return [
    ...current.filter((citation) => !removed.has(citationKey(citation))),
    ...(patch.add ?? []),
  ];
}

function citationKey(citation: FeatureRequirementCitation): string {
  return `${citation.entityType}:${citation.entityId}`;
}

function cloneRecord(
  record: FeatureRequirementDraftRecord,
): FeatureRequirementDraftRecord {
  return {
    ...record,
    designedBy: [...record.designedBy],
    fulfilledBy: [...record.fulfilledBy],
    contracts: [...record.contracts],
  };
}
