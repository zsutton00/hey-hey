import type {
  WorkItemChangeSetValidationRequest,
  WorkItemChangeSetOperation,
} from '../../generated';
import {
  canonicalDiagramType,
  withDiagramDefaults,
} from '../tasks/diagram-metadata';

/** Compile historical vocabulary once into a new durable intent; retain proposal evidence. */
export function normalizeDiagramChangeSet(
  request: WorkItemChangeSetValidationRequest,
): WorkItemChangeSetValidationRequest {
  const operations: WorkItemChangeSetOperation[] = request.operations.map(
    (operation) =>
      operation.op === 'workItem.create' && operation.type
        ? { ...operation, type: canonicalDiagramType(operation.type) }
        : operation,
  );
  for (const operation of [...operations]) {
    if (operation.op !== 'workItem.create') continue;
    for (const section of withDiagramDefaults(operation.type ?? 'STANDARD')) {
      const authored = operations.some(
        (candidate) =>
          (candidate.op === 'section.replace' ||
            candidate.op === 'section.clear') &&
          candidate.ref.refType === 'temporary' &&
          candidate.ref.tempId === operation.ref.tempId &&
          candidate.key === section.key,
      );
      if (!authored)
        operations.push({
          op: 'section.replace',
          ref: operation.ref,
          key: section.key,
          content: section.content,
        });
    }
  }
  return { ...request, operations };
}
