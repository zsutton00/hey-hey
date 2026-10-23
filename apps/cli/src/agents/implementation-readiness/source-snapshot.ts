import { createHash } from 'node:crypto';
import type {
  ImplementationReadinessSourceSnapshot,
  ReadinessFocalEntityType,
} from '../../shared/api/generated/api';
import type { AgentStartupPromptInputResult } from '../../commands/agent-startup-prompt-input';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import {
  RunEntityReferenceEntityTypeEnum as RunEntityType,
  type RunEntityReference,
} from '../../shared/agent-bridge-contract/generated/api';
import { canonicalizeJson, type CanonicalJsonValue } from '../../shared/canonical-json';

export interface ReadinessSourceRevisionInput {
  readonly runId: string;
  readonly focalEntityId: string;
  readonly focalEntityType: ReadinessFocalEntityType;
  readonly sourceValues: Readonly<Record<string, string | null | readonly string[]>>;
  readonly capturedAt: string;
}

const toCanonicalSourceValues = (
  sourceValues: ReadinessSourceRevisionInput['sourceValues'],
): { readonly [key: string]: CanonicalJsonValue } =>
  Object.fromEntries(
    Object.entries(sourceValues)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        value === null ? null : [...(Array.isArray(value) ? value : [value])],
      ]),
  );

/**
 * Computes a stable revision from the authoritative source values used by a
 * readiness pass. Cosmetic presentation data is intentionally absent: a
 * revision changes only when the checked decision context changes.
 */
export const computeReadinessSourceRevision = (input: ReadinessSourceRevisionInput): string => {
  const canonicalSource: CanonicalJsonValue = {
    focalEntityId: input.focalEntityId,
    focalEntityType: input.focalEntityType,
    sourceValues: toCanonicalSourceValues(input.sourceValues),
  };
  return `sha256:${createHash('sha256').update(canonicalizeJson(canonicalSource)).digest('hex')}`;
};

export const createReadinessSourceSnapshot = (
  input: ReadinessSourceRevisionInput,
): ImplementationReadinessSourceSnapshot => ({
  runId: input.runId,
  focalEntityId: input.focalEntityId,
  focalEntityType: input.focalEntityType,
  sourceRevision: computeReadinessSourceRevision(input),
  capturedAt: input.capturedAt,
});

const readinessSourceSnapshotsMatch = (
  expected: ImplementationReadinessSourceSnapshot,
  actual: ImplementationReadinessSourceSnapshot,
): boolean =>
  expected.runId === actual.runId &&
  expected.focalEntityId === actual.focalEntityId &&
  expected.focalEntityType === actual.focalEntityType &&
  expected.sourceRevision === actual.sourceRevision;

const optionalString = (value: string | number | null | undefined): string | null =>
  value === undefined || value === null ? null : String(value);

const entityLabel = (loadedContext: LoadedEntityPromptContext): string => {
  const label =
    'name' in loadedContext.entity ? loadedContext.entity.name : loadedContext.entity.title;
  return optionalString(label) ?? '';
};

const entityType = (loadedContext: LoadedEntityPromptContext): string => {
  const type =
    'type' in loadedContext.entity
      ? loadedContext.entity.type
      : loadedContext.focalEntity.entityType;
  return optionalString(type) ?? loadedContext.focalEntity.entityType;
};

const readinessFocalEntityType = (
  loadedContext: LoadedEntityPromptContext,
): ReadinessFocalEntityType | null => {
  switch (loadedContext.focalEntity.entityType) {
    case RunEntityType.DesignDoc:
      return 'DESIGN_DOC';
    case RunEntityType.Task:
      if (entityType(loadedContext) === 'FEATURE') return 'FEATURE';
      return loadedContext.context.taskType === 'PLAN' || entityType(loadedContext) === 'PLAN'
        ? 'PLAN'
        : 'TASK';
    default:
      return null;
  }
};

const sectionValues = (sections: Readonly<Record<string, string>> | undefined): readonly string[] =>
  Object.entries(sections ?? {})
    .map(([key, value]) => `${key}\u0000${value}`)
    .sort();

const entitySectionValues = (loadedContext: LoadedEntityPromptContext): readonly string[] => {
  if (!('sections' in loadedContext.entity) || !Array.isArray(loadedContext.entity.sections)) {
    return [];
  }
  return loadedContext.entity.sections
    .map((section) => `${section.key}\u0000${section.materializedMarkdown}`)
    .sort();
};

const featureHierarchyValues = (loadedContext: LoadedEntityPromptContext): readonly string[] =>
  (loadedContext.context.featureHierarchy ?? [])
    .map((entry) =>
      [
        entry.id,
        entry.relationshipType,
        entry.relationship ?? null,
        entry.direction ?? null,
        entry.parentTaskId ?? null,
        entry.description ?? null,
        entry.reasoning ?? null,
      ]
        .map((value) => value ?? '')
        .join('\u0000'),
    )
    .sort();

const relatedEntityValues = (loadedContext: LoadedEntityPromptContext): readonly string[] =>
  (loadedContext.context.relatedEntities ?? [])
    .map((entry) =>
      [
        entry.entityId,
        entry.entityType,
        entry.displayName,
        entry.status ?? null,
        entry.relationship,
        entry.reasoning ?? null,
        ...(entry.via ?? []).map(
          (via) => `${via.entityId}\u0000${via.entityType}\u0000${via.relationship}`,
        ),
      ]
        .map((value) => value ?? '')
        .join('\u0000'),
    )
    .sort();

const planContextValues = (loadedContext: LoadedEntityPromptContext): readonly string[] => {
  const planContext = loadedContext.context.planContext;
  if (!planContext) return [];
  const entryValue = (label: string, entry: NonNullable<typeof planContext.parentPlan>): string =>
    [
      label,
      entry.id,
      entry.entityType,
      entry.taskType ?? null,
      entry.displayName,
      entry.status ?? null,
      entry.sequenceOrder ?? null,
    ]
      .map((value) => value ?? '')
      .join('\u0000');
  return [
    ...(planContext.parentPlan ? [entryValue('parentPlan', planContext.parentPlan)] : []),
    ...(planContext.parentStage ? [entryValue('parentStage', planContext.parentStage)] : []),
    ...(planContext.siblingStages ?? []).map((stage) => entryValue('siblingStage', stage)),
  ].sort();
};

const sourceValuesForLoadedContext = (
  loadedContext: LoadedEntityPromptContext,
  startupInput: AgentStartupPromptInputResult,
): ReadinessSourceRevisionInput['sourceValues'] => {
  const entity = loadedContext.entity;
  const context = loadedContext.context;
  return {
    'entity.id': optionalString(entity.id),
    'entity.label': entityLabel(loadedContext),
    'entity.type': entityType(loadedContext),
    'entity.parentTaskId': 'parentTaskId' in entity ? optionalString(entity.parentTaskId) : null,
    'entity.parentEntityId':
      'parentEntityId' in entity ? optionalString(entity.parentEntityId) : null,
    'entity.summary': 'summary' in entity ? optionalString(entity.summary) : null,
    'context.entityId': optionalString(context.entityId),
    'context.entityType': optionalString(context.entityType),
    'context.taskType': context.taskType ?? null,
    'context.displayName': optionalString(context.displayName),
    'context.contentSections': sectionValues(context.content?.sections),
    'context.contentStatus': context.content?.status ?? null,
    'context.contentPriority': context.content?.priority ?? null,
    'context.contentAssigneeId': context.content?.assigneeId ?? null,
    'context.contentDueDate': context.content?.dueDate ?? null,
    'context.entitySections': entitySectionValues(loadedContext),
    'context.featureHierarchy': featureHierarchyValues(loadedContext),
    'context.relatedEntities': relatedEntityValues(loadedContext),
    'context.planContext': planContextValues(loadedContext),
    'template.revisionId': optionalString(startupInput.provenance.revisionId),
    'template.revisionNumber': optionalString(startupInput.provenance.revisionNumber),
  };
};

export interface ReadinessSourceSnapshotFromStartupInput {
  readonly runId: string;
  readonly startupPromptInput: AgentStartupPromptInputResult;
  readonly capturedAt: string;
}

/**
 * Projects the authoritative startup Context into the source revision used by
 * the readiness gate. The projection deliberately contains semantic entity,
 * topology, plan, and content values only; presentation-only prompt text is
 * not part of the revision.
 */
export const createReadinessSourceSnapshotFromStartupInput = (
  input: ReadinessSourceSnapshotFromStartupInput,
): ImplementationReadinessSourceSnapshot | null => {
  const loadedContext = input.startupPromptInput.loadedEntityContext;
  const focalEntityType = readinessFocalEntityType(loadedContext);
  if (focalEntityType === null) return null;

  const focalEntity: RunEntityReference = loadedContext.focalEntity;
  return createReadinessSourceSnapshot({
    runId: input.runId,
    focalEntityId: focalEntity.entityId,
    focalEntityType,
    sourceValues: sourceValuesForLoadedContext(loadedContext, input.startupPromptInput),
    capturedAt: input.capturedAt,
  });
};
