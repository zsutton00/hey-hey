import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { cloneDeep, isEqual } from 'lodash';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import type { Prisma } from '@prisma/client';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type {
  FutureCompletionDependency,
  FutureDesignDocChanges,
  FutureRevisionAuthoring,
  FutureRevisionBaseline,
  FutureRevisionChange,
  FutureRevisionContent,
  FutureRevisionMutation,
  FutureWorkItemChanges,
  ProjectedWorkItemChangeSetResponse,
  WorkItemChangeSetValidationRequest,
  UpdateTaskDto,
} from 'src/generated';
import {
  futureDesignDocChangesSchema,
  futureRevisionAuthoringSchema,
  futureWorkItemChangesSchema,
} from 'src/generated/future-revision.schema';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';

import {
  assertFutureGraphBoundary,
  futureGraph,
  graphChangeSet,
  serializableGraphProjection,
} from './future-graph';

const logger = new Logger('FutureRevisionMaterializer');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addFormat('branded-ServiceId', true);
const validateAuthoring = ajv.compile<FutureRevisionAuthoring>(
  futureRevisionAuthoringSchema,
);
const validateWorkItemChanges = ajv.compile<FutureWorkItemChanges>(
  futureWorkItemChangesSchema,
);
const validateDesignDocChanges = ajv.compile<FutureDesignDocChanges>(
  futureDesignDocChangesSchema,
);

export type FutureTargetType = 'TASK' | 'DESIGN_DOC';

export type FutureTarget = {
  organizationId: string;
  projectId: string;
  targetEntityType: FutureTargetType;
  targetEntityId: string;
};

export interface FutureRevisionMaterializerPorts {
  projectGraph(
    target: FutureTarget,
    basis: ProjectedWorkItemChangeSetResponse,
    request: WorkItemChangeSetValidationRequest,
  ): Promise<ProjectedWorkItemChangeSetResponse>;
  readLiveContent(target: FutureTarget): Promise<FutureRevisionContent>;
  readLiveRevision(
    tx: AnyTransactionClient,
    target: FutureTarget,
  ): Promise<string>;
  renderTaskSections(
    projectId: string,
    taskType: string,
    sections: NonNullable<UpdateTaskDto['sections']>,
  ): Array<{ key: string; content: string }>;
  renderRequirementOps(
    tx: AnyTransactionClient,
    target: FutureTarget,
    requirementOps: NonNullable<UpdateTaskDto['requirementOps']>,
    baselineMarkdown: string,
  ): Promise<string>;
}

type TaskContent = Extract<FutureRevisionContent, { type: string }>;
type DesignDocContent = Exclude<FutureRevisionContent, { type: string }>;

/** Rejections name the authored field so agents can correct one input. */
function rejectAt(path: string, message: string): BadRequestException {
  return new BadRequestException({
    message: `${path}: ${message}`,
    errors: [{ instancePath: path.replace(/^mutation/, ''), message }],
  });
}

function contractViolation(errors: ErrorObject[] | null | undefined) {
  return new BadRequestException({
    message: 'Future revision violates the OpenAPI contract',
    errors: errors ?? [],
  });
}

/** Validates the delta against the change shape of the proposal target's type. */
export function parseFutureRevisionAuthoring(
  value: unknown,
  targetEntityType: FutureTargetType,
): FutureRevisionAuthoring {
  if (!validateAuthoring(value)) {
    throw contractViolation(validateAuthoring.errors);
  }
  if (value.operation !== 'REVISE') return value;
  const validateChanges =
    targetEntityType === 'TASK'
      ? validateWorkItemChanges
      : validateDesignDocChanges;
  if (!validateChanges(value.changes)) {
    throw contractViolation(
      (validateChanges.errors ?? []).map((error) => ({
        ...error,
        instancePath: `/changes${error.instancePath}`,
      })),
    );
  }
  return value;
}

/**
 * Reads the selected baseline and applies the delta, returning the complete
 * FutureRevisionMutation the existing validator, approval and Apply consume.
 */
export async function materializeFutureRevision(
  tx: AnyTransactionClient,
  ports: FutureRevisionMaterializerPorts,
  target: FutureTarget,
  authoring: FutureRevisionAuthoring,
): Promise<FutureRevisionMutation> {
  if (authoring.operation === 'CANCEL') {
    logger.log(
      `Future ${authoring.futureId} cancellation passes through unchanged for ${target.targetEntityType} ${target.targetEntityId}`,
    );
    return authoring;
  }
  await assertTargetAvailable(tx, target);

  const { start, baseline, dependencies } =
    authoring.expectedRevision === 0
      ? await startNewFuture(tx, ports, target, authoring)
      : await startRefinement(tx, ports, target, authoring);

  const result =
    target.targetEntityType === 'TASK'
      ? await applyWorkItemChanges(
          tx,
          ports,
          target,
          start as TaskContent,
          authoring.changes as FutureWorkItemChanges,
        )
      : applyDesignDocChanges(
          start as DesignDocContent,
          authoring.changes as FutureDesignDocChanges,
        );

  copyUnappliedFields(target.targetEntityType, baseline.content, result);

  logger.log(
    `Materialized future ${authoring.futureId} for ${target.targetEntityType} ${target.targetEntityId} ` +
      `(expectedRevision ${authoring.expectedRevision}, baseline ${baseline.kind} ${baseline.revision}, ` +
      `${dependencies.length} dependency(ies))`,
  );
  return {
    operation: 'REVISE',
    futureId: authoring.futureId,
    expectedRevision: authoring.expectedRevision,
    baseline,
    result,
    ...(futureGraph(baseline.content) && futureGraph(result)
      ? {
          graphChangeSet: graphChangeSet(
            futureGraph(baseline.content)!,
            futureGraph(result)!,
          ),
        }
      : {}),
    dependencies,
  };
}

/** Apply never writes these, so a future that differed from its baseline in them is rejected. */
function copyUnappliedFields(
  targetEntityType: FutureTargetType,
  baseline: FutureRevisionContent,
  result: FutureRevisionContent,
): void {
  const from = baseline as unknown as Record<string, unknown>;
  const to = result as unknown as Record<string, unknown>;
  const fields =
    targetEntityType === 'TASK' ? ['status', 'config', 'source'] : ['status'];
  for (const field of fields) {
    if (isEqual(to[field], from[field])) continue;
    if (from[field] === undefined) delete to[field];
    else to[field] = cloneDeep(from[field]);
  }
}

async function assertTargetAvailable(
  tx: AnyTransactionClient,
  target: FutureTarget,
): Promise<void> {
  const db = tx as Prisma.TransactionClient;
  const where = {
    id: target.targetEntityId,
    organizationId: target.organizationId,
    projectId: target.projectId,
  };
  const row =
    target.targetEntityType === 'TASK'
      ? await db.task.findFirst({ where, select: { archivedAt: true } })
      : await db.designDoc.findFirst({ where, select: { archivedAt: true } });
  if (!row || row.archivedAt) {
    logger.warn(
      `Rejected future for missing or archived ${target.targetEntityType} ${target.targetEntityId}`,
    );
    throw new NotFoundException(
      'targetEntityId: future target is missing or archived in this project.',
    );
  }
}

async function startNewFuture(
  tx: AnyTransactionClient,
  ports: FutureRevisionMaterializerPorts,
  target: FutureTarget,
  authoring: FutureRevisionChange,
) {
  const selection = authoring.baseline ?? { kind: 'LIVE' as const };
  const baseline =
    selection.kind === 'FUTURE'
      ? await readParentBaseline(tx, target, authoring.futureId, selection)
      : await readLiveBaseline(tx, ports, target);
  return {
    start: baseline.content,
    baseline,
    dependencies: authoring.dependencies ?? [],
  };
}

async function startRefinement(
  tx: AnyTransactionClient,
  ports: FutureRevisionMaterializerPorts,
  target: FutureTarget,
  authoring: FutureRevisionChange,
) {
  const db = tx as Prisma.TransactionClient;
  const future = await db.proposalFuture.findFirst({
    where: {
      id: authoring.futureId,
      organizationId: target.organizationId,
      projectId: target.projectId,
    },
    include: { dependencies: { orderBy: { targetEntityId: 'asc' } } },
  });
  if (
    !future ||
    future.targetEntityId !== target.targetEntityId ||
    future.targetEntityType !== target.targetEntityType
  ) {
    logger.warn(
      `Rejected refinement of unknown future ${authoring.futureId} for ${target.targetEntityType} ${target.targetEntityId}`,
    );
    throw new NotFoundException(
      'mutation/futureId: no future with this id exists for this target in this project.',
    );
  }
  if (
    future.outcome !== 'STAGED' ||
    future.revision !== authoring.expectedRevision
  ) {
    logger.warn(
      `Rejected stale refinement of future ${future.id}: expected ${authoring.expectedRevision}, current ${future.revision} (${future.outcome})`,
    );
    throw new ConflictException(
      `mutation/expectedRevision: future is at reviewed revision ${future.revision} ` +
        `with outcome ${future.outcome}; refine the current revision.`,
    );
  }
  // Refinements build on what reviewers already accepted, never on live content.
  const start = future.result as unknown as FutureRevisionContent;
  const baseline = !authoring.baseline
    ? (future.baseline as unknown as FutureRevisionBaseline)
    : authoring.baseline.kind === 'FUTURE'
      ? await readParentBaseline(
          tx,
          target,
          authoring.futureId,
          authoring.baseline,
        )
      : await readLiveBaseline(tx, ports, target);
  const dependencies: FutureCompletionDependency[] =
    authoring.dependencies ??
    future.dependencies.map((dependency) => ({
      edgeType: 'DEPENDS_ON',
      targetEntityType: 'TASK',
      targetEntityId: dependency.targetEntityId,
    }));
  return { start, baseline, dependencies };
}

async function readLiveBaseline(
  tx: AnyTransactionClient,
  ports: FutureRevisionMaterializerPorts,
  target: FutureTarget,
): Promise<FutureRevisionBaseline> {
  // Read the token first: a concurrent write then leaves an older token beside
  // newer content, which the content-based baseline check still treats correctly.
  const revision = await ports.readLiveRevision(tx, target);
  const content = projectLiveContent(
    target.targetEntityType,
    await ports.readLiveContent(target),
  );
  return { kind: 'LIVE', revision, content };
}

async function readParentBaseline(
  tx: AnyTransactionClient,
  target: FutureTarget,
  futureId: string,
  selection: { futureId: string; revision: number },
): Promise<FutureRevisionBaseline> {
  if (selection.futureId === futureId) {
    throw rejectAt(
      'mutation/baseline/futureId',
      'select a distinct reviewed parent future.',
    );
  }
  const parent = await (
    tx as Prisma.TransactionClient
  ).proposalFuture.findFirst({
    where: {
      id: selection.futureId,
      organizationId: target.organizationId,
      projectId: target.projectId,
      targetEntityId: target.targetEntityId,
      targetEntityType: target.targetEntityType,
    },
    include: { history: { where: { revision: selection.revision } } },
  });
  const entry = parent?.history[0]?.mutation as unknown as
    | FutureRevisionMutation
    | undefined;
  if (!entry) {
    throw rejectAt(
      'mutation/baseline',
      `no reviewed revision ${selection.revision} of future ${selection.futureId} exists for this target.`,
    );
  }
  if (entry.operation !== 'REVISE') {
    throw rejectAt(
      'mutation/baseline/revision',
      `revision ${selection.revision} of the parent future is a cancellation, not reviewed content.`,
    );
  }
  return {
    kind: 'FUTURE',
    futureId: selection.futureId,
    revision: String(selection.revision),
    content: entry.result,
  };
}

// Section provenance is response metadata that basis checks and Apply ignore;
// live reads report '' when no proposal is recorded, which the uuid contract rejects.
const NO_SECTION_PROVENANCE = '00000000-0000-0000-0000-000000000000';
const TASK_CONTENT_FIELDS = [
  'id',
  'organizationId',
  'projectId',
  'name',
  'type',
  'graph',
  'status',
  'source',
  'config',
  'priority',
  'tag',
  'initiativeId',
  'dueDate',
  'assigneeId',
  'parentTaskId',
] as const;
const DESIGN_DOC_CONTENT_FIELDS = [
  'id',
  'organizationId',
  'projectId',
  'name',
  'template',
  'status',
  'tags',
  'summary',
  'parentEntityId',
  'parentEntityType',
  'createdAt',
  'updatedAt',
] as const;
const NULLABLE_CONTENT_FIELDS = new Set([
  'config',
  'assigneeId',
  'projectId',
  'parentEntityId',
  'parentEntityType',
]);

function jsonValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/** Live reads carry response-only fields and nulls the stored content contract does not accept. */
function projectLiveContent(
  targetEntityType: FutureTargetType,
  raw: FutureRevisionContent,
): FutureRevisionContent {
  const source = raw as unknown as Record<string, unknown>;
  const fields =
    targetEntityType === 'TASK'
      ? TASK_CONTENT_FIELDS
      : DESIGN_DOC_CONTENT_FIELDS;
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    const value = jsonValue(source[field]);
    if (value === undefined) continue;
    if (value === null && !NULLABLE_CONTENT_FIELDS.has(field)) continue;
    projected[field] =
      field === 'graph' && value
        ? serializableGraphProjection(
            value as ProjectedWorkItemChangeSetResponse,
          )
        : value;
  }
  projected.sections = raw.sections.map((section) => {
    const record = section as unknown as Record<string, unknown>;
    return {
      id: record.id,
      key: record.key,
      order: record.order,
      materializedMarkdown: record.materializedMarkdown ?? '',
      ...(targetEntityType === 'TASK'
        ? {
            materializedProposalId:
              record.materializedProposalId || NO_SECTION_PROVENANCE,
          }
        : {}),
      ...(record.crdtSnapshotSeq !== undefined
        ? { crdtSnapshotSeq: record.crdtSnapshotSeq }
        : {}),
    };
  });
  return projected as unknown as FutureRevisionContent;
}

const TASK_SCALAR_CHANGES = [
  'name',
  'priority',
  'tag',
  'initiativeId',
  'dueDate',
  'assigneeId',
  'parentTaskId',
] as const;
const DESIGN_DOC_SCALAR_CHANGES = [
  'name',
  'template',
  'tags',
  'summary',
  'parentEntityId',
  'parentEntityType',
] as const;

/** Only fields that actually change are touched so untouched fields stay identical to the baseline. */
function applyScalarChanges(
  result: Record<string, unknown>,
  changes: Record<string, unknown>,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (!(field in changes)) continue;
    const value = changes[field];
    if (isEqual(result[field] ?? null, value ?? null)) continue;
    if (value === null && !NULLABLE_CONTENT_FIELDS.has(field)) {
      delete result[field];
    } else {
      result[field] = value;
    }
  }
}

function assertUniqueSectionKeys(sections: ReadonlyArray<{ key: string }>) {
  const seen = new Set<string>();
  sections.forEach((section, index) => {
    if (seen.has(section.key)) {
      throw rejectAt(
        `mutation/changes/sections/${index}/key`,
        `section "${section.key}" appears more than once.`,
      );
    }
    seen.add(section.key);
  });
}

function rethrowAddressed(error: unknown, path: string): never {
  if (error instanceof HttpException) throw rejectAt(path, error.message);
  throw error;
}

function replaceTaskSection(
  result: TaskContent,
  key: string,
  content: string,
  order: number | undefined,
): void {
  const existing = result.sections.find((section) => section.key === key);
  if (existing) {
    if (existing.materializedMarkdown !== content) {
      existing.materializedMarkdown = content;
    }
    if (order !== undefined) existing.order = order;
    return;
  }
  result.sections.push({
    id: randomUUID(),
    key,
    order: order ?? Math.max(-1, ...result.sections.map((s) => s.order)) + 1,
    materializedMarkdown: content,
    materializedProposalId: NO_SECTION_PROVENANCE,
  });
}

async function applyWorkItemChanges(
  tx: AnyTransactionClient,
  ports: FutureRevisionMaterializerPorts,
  target: FutureTarget,
  start: TaskContent,
  changes: FutureWorkItemChanges,
): Promise<TaskContent> {
  const result = cloneDeep(start);
  applyScalarChanges(
    result as unknown as Record<string, unknown>,
    changes as Record<string, unknown>,
    TASK_SCALAR_CHANGES,
  );
  const sections = changes.sections ?? [];
  const requirementOps = changes.requirementOps ?? [];
  assertUniqueSectionKeys(sections);
  if (requirementOps.length > 0) {
    if (start.type !== WORK_ITEM_TYPE_KEYS.Feature) {
      throw rejectAt(
        'mutation/changes/requirementOps',
        'requirement operations apply only to Features.',
      );
    }
    if (sections.some((section) => section.key === 'requirements')) {
      throw rejectAt(
        'mutation/changes/requirementOps',
        'change requirements through requirementOps or sections[requirements], not both.',
      );
    }
  }
  if (sections.length > 0) {
    let rendered: Array<{ key: string; content: string }>;
    try {
      rendered = ports.renderTaskSections(
        target.projectId,
        start.type,
        sections,
      );
    } catch (error) {
      rethrowAddressed(error, 'mutation/changes/sections');
    }
    rendered.forEach((section, index) =>
      replaceTaskSection(
        result,
        section.key,
        section.content,
        sections[index]?.order,
      ),
    );
  }
  if (requirementOps.length > 0) {
    const current =
      result.sections.find((section) => section.key === 'requirements')
        ?.materializedMarkdown ?? '';
    let markdown: string;
    try {
      markdown = await ports.renderRequirementOps(
        tx,
        target,
        requirementOps,
        current,
      );
    } catch (error) {
      rethrowAddressed(error, 'mutation/changes/requirementOps');
    }
    replaceTaskSection(result, 'requirements', markdown, undefined);
  }
  if (changes.operations?.length || result.graph) {
    if (!start.graph)
      throw rejectAt(
        'mutation.changes.operations',
        'target has no captured graph; reconcile this future against a complete current graph before editing its graph.',
      );
    // Root field/section edits and graph edits share the same projected result.
    const root = structuredClone(start.graph.projectedRoot);
    for (const field of [
      'name',
      'priority',
      'tag',
      'dueDate',
      'assigneeId',
    ] as const) {
      if (result[field] !== undefined)
        Object.assign(root, { [field]: result[field] });
    }
    root.label = root.name;
    if (changes.parentTaskId !== undefined) {
      if (changes.parentTaskId === null) delete root.parent;
      else root.parent = { refType: 'existing', id: changes.parentTaskId };
    }
    for (const section of changes.sections ?? []) {
      const existing = root.sections.find((s) => s.key === section.key);
      if (existing) existing.content = section.content;
      else root.sections.push({ key: section.key, content: section.content });
    }
    const basis = {
      ...start.graph,
      projectedRoot: root,
      sections: root.sections,
    };
    const request = {
      root: root.identity,
      operations: changes.operations ?? [],
    };
    assertFutureGraphBoundary(start.graph, request);
    result.graph = serializableGraphProjection(
      await ports.projectGraph(target, basis, request),
    );
    if (!result.graph.valid)
      throw new BadRequestException({
        message: 'Future graph is invalid',
        issues: result.graph.issues,
      });
    // Keep the root response projection consistent with graph-authored sections.
    if (
      !isEqual(
        start.graph.projectedRoot.parent ?? null,
        result.graph.projectedRoot.parent ?? null,
      )
    ) {
      const parent = result.graph.projectedRoot.parent;
      if (parent?.refType === 'existing') result.parentTaskId = parent.id;
      else delete result.parentTaskId;
    }
    for (const field of [
      'name',
      'priority',
      'tag',
      'dueDate',
      'assigneeId',
    ] as const) {
      const value = result.graph.projectedRoot[field];
      if (value !== undefined) Object.assign(result, { [field]: value });
    }
    for (const section of result.graph.projectedRoot.sections) {
      const previous = start.graph.projectedRoot.sections.find(
        (s) => s.key === section.key,
      );
      if (isEqual(previous?.content, section.content)) continue;
      replaceTaskSection(
        result,
        section.key,
        section.content === null
          ? ''
          : typeof section.content === 'string'
            ? section.content
            : JSON.stringify(section.content),
        undefined,
      );
    }
  }
  return result;
}

function applyDesignDocChanges(
  start: DesignDocContent,
  changes: FutureDesignDocChanges,
): DesignDocContent {
  const result = cloneDeep(start);
  applyScalarChanges(
    result as unknown as Record<string, unknown>,
    changes as Record<string, unknown>,
    DESIGN_DOC_SCALAR_CHANGES,
  );
  const sections = changes.sections ?? [];
  assertUniqueSectionKeys(sections);
  sections.forEach((change, index) => {
    // Design-doc Apply updates existing sections only, so a new key could never land.
    const existing = result.sections.find(
      (section) => section.key === change.key,
    );
    if (!existing) {
      throw rejectAt(
        `mutation/changes/sections/${index}/key`,
        `section "${change.key}" does not exist on this design doc; existing keys: ` +
          `${result.sections.map((section) => section.key).join(', ') || '(none)'}.`,
      );
    }
    if (existing.materializedMarkdown !== change.content) {
      existing.materializedMarkdown = change.content;
    }
    if (change.order !== undefined && change.order !== null) {
      existing.order = change.order;
    }
  });
  return result;
}
