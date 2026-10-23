import { BadRequestException } from '@nestjs/common';
import { EVENT_TYPES } from '../core/events/types/event.types';
import type { Initiative } from '@prisma/client';
import type {
  InitiativeCreatedEventPayload,
  InitiativeEventUpdateSnapshot,
  UpdateInitiativeDto,
} from '../generated';
import type { InitiativeId, OrganizationId, ProjectId } from '../types';
import type { MaterializedWorkItemSection } from '../types/work-item-section.types';

const INITIATIVE_EVENT_FIELDS = [
  'description',
  'details',
  'acceptanceCriteria',
] as const;

type InitiativeEventField = (typeof INITIATIVE_EVENT_FIELDS)[number];

export type InitiativeEventContentSnapshot = Record<
  InitiativeEventField,
  string
>;

export function buildInitiativeEventContentSnapshot(
  values: Partial<Record<InitiativeEventField, string | null | undefined>>,
): InitiativeEventContentSnapshot {
  return {
    description: values.description ?? '',
    details: values.details ?? '',
    acceptanceCriteria: values.acceptanceCriteria ?? '',
  };
}

export function buildInitiativeEventContentSnapshotFromSections(
  sections?: MaterializedWorkItemSection[],
): InitiativeEventContentSnapshot {
  if (!sections || sections.length === 0) {
    throw new BadRequestException(
      'Initiative is missing collaborative sections; run backfill.',
    );
  }

  const keys = new Set(sections.map((section) => section.key));
  const missing = INITIATIVE_EVENT_FIELDS.filter((key) => !keys.has(key));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Initiative is missing section content: ${missing.join(', ')}`,
    );
  }

  return extractInitiativeSectionContent(sections);
}

export function buildInitiativeEventSnapshot(params: {
  initiative: Initiative;
  content: InitiativeEventContentSnapshot;
  linkedProjectIds: ProjectId[];
}): InitiativeCreatedEventPayload['initiative'] {
  const { initiative, content, linkedProjectIds } = params;
  return {
    id: initiative.id as InitiativeId,
    name: initiative.name,
    description: content.description,
    details: content.details,
    acceptanceCriteria: content.acceptanceCriteria,
    organizationId: initiative.organizationId as OrganizationId,
    status: initiative.status,
    priority: initiative.priority ?? undefined,
    dueDate: initiative.dueDate?.toISOString() ?? undefined,
    tags: initiative.tags,
    originatingProjectId: initiative.originatingProjectId as ProjectId,
    linkedProjectIds,
  };
}

export function buildInitiativeCreatedEventPayload(params: {
  initiative: Initiative;
  projectId: ProjectId;
  linkedProjectIds: ProjectId[];
  content: InitiativeEventContentSnapshot;
}): InitiativeCreatedEventPayload {
  const { initiative, projectId, linkedProjectIds, content } = params;

  return {
    payloadType: EVENT_TYPES.INITIATIVE.CREATED,
    organizationId: initiative.organizationId as OrganizationId,
    projectId,
    initiative: buildInitiativeEventSnapshot({
      initiative,
      content,
      linkedProjectIds,
    }),
  };
}

export function buildInitiativeEventUpdateSnapshot(
  updates: UpdateInitiativeDto,
): InitiativeEventUpdateSnapshot {
  const snapshot: InitiativeEventUpdateSnapshot = {};

  if (updates.name !== undefined) {
    snapshot.name = updates.name;
  }
  if (updates.assigneeId !== undefined) {
    snapshot.assigneeId = updates.assigneeId ?? undefined;
  }
  if (updates.reasoning !== undefined) {
    snapshot.reasoning = updates.reasoning ?? undefined;
  }
  if (updates.status !== undefined) {
    snapshot.status = updates.status;
  }
  if (updates.priority !== undefined) {
    snapshot.priority = updates.priority;
  }
  if (updates.creatorType !== undefined) {
    snapshot.creatorType = updates.creatorType;
  }
  if (updates.dueDate !== undefined) {
    snapshot.dueDate = updates.dueDate ?? undefined;
  }
  if (updates.tags !== undefined) {
    snapshot.tags = updates.tags ?? [];
  }

  return snapshot;
}

export function extractInitiativeSectionContent(
  sections?: MaterializedWorkItemSection[],
): InitiativeEventContentSnapshot {
  const content: InitiativeEventContentSnapshot = {
    description: '',
    details: '',
    acceptanceCriteria: '',
  };
  if (!sections || sections.length === 0) {
    return content;
  }

  for (const section of sections) {
    if (INITIATIVE_EVENT_FIELDS.includes(section.key as InitiativeEventField)) {
      content[section.key as InitiativeEventField] =
        section.materializedMarkdown;
    }
  }

  return content;
}
