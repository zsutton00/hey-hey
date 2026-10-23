import { type WorkItemTypeKey } from 'src/services/tasks/work-item-type-keys';
import { BadRequestException } from '@nestjs/common';
import type {
  FeatureTag,
  UpdateTaskDto,
  TaskCreatedEventPayload,
  TaskEventUpdateSnapshot,
  TaskPriority,
  TaskEventContentSnapshot as GeneratedTaskEventContentSnapshot,
  TaskEventSectionSnapshot,
} from '../generated';
import type {
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../types';
import {
  FeatureRequirementsReadError,
  readCanonicalFeatureRequirementsContent,
} from '../services/tasks/feature-requirements-reader';

const TASK_EVENT_CONTENT_FIELDS = [
  'description',
  'acceptanceCriteria',
  'requirements',
] as const;

type TaskEventContentField = (typeof TASK_EVENT_CONTENT_FIELDS)[number];

export type TaskEventContentSnapshot = GeneratedTaskEventContentSnapshot;

type TaskSnapshotSource = {
  name: string;
  type: WorkItemTypeKey;
  tag?: string | null;
  description?: string | null;
  acceptanceCriteria?: string | null;
  requirements?: string | null;
  projectId: string;
  initiativeId: string | null;
  status: TaskCreatedEventPayload['task']['status'];
  priority?: TaskPriority | null;
  dueDate?: Date | null;
  assigneeId?: string | null;
  parentTaskId?: string | null;
  id: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
};

export function buildTaskEventContentSnapshot(values: {
  type: WorkItemTypeKey;
  tag?: string | null;
  description?: string | null;
  acceptanceCriteria?: string | null;
  requirements?: string | null;
}): TaskEventContentSnapshot {
  if (values.description === undefined || values.description === null) {
    throw new BadRequestException(
      'Task event snapshot requires description content.',
    );
  }

  if (values.type === 'STANDARD') {
    if (
      values.acceptanceCriteria === undefined ||
      values.acceptanceCriteria === null
    ) {
      throw new BadRequestException(
        'STANDARD task event snapshot requires acceptance criteria content.',
      );
    }

    return {
      type: values.type,
      description: values.description,
      acceptanceCriteria: values.acceptanceCriteria,
    };
  }

  if (values.type === 'FEATURE') {
    if (values.requirements === undefined || values.requirements === null) {
      throw new BadRequestException(
        'FEATURE task event snapshot requires requirements content.',
      );
    }

    let requirements: string | undefined;
    try {
      requirements = readCanonicalFeatureRequirementsContent(
        values.requirements,
      );
    } catch (error) {
      const diagnostic =
        error instanceof FeatureRequirementsReadError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new BadRequestException(
        `FEATURE task event snapshot requirements content is invalid: ${diagnostic}`,
      );
    }
    if (requirements === undefined) {
      throw new BadRequestException(
        'FEATURE task event snapshot requires requirements content.',
      );
    }

    return {
      type: values.type,
      description: values.description,
      requirements,
      ...(values.tag != null ? { tag: values.tag as FeatureTag } : {}),
    };
  }

  if (values.type === 'GOAL') {
    return {
      type: values.type,
      description: values.description,
    };
  }

  return {
    type: values.type,
    description: values.description,
  };
}

export function buildTaskEventContentSnapshotFromSections(
  taskType: WorkItemTypeKey,
  sections: TaskEventSectionSnapshot[] = [],
  tag?: string | null,
): TaskEventContentSnapshot {
  const content = extractTaskSectionContent(sections);
  return {
    ...buildTaskEventContentSnapshot({
      type: taskType,
      tag,
      description: content.description ?? '',
      acceptanceCriteria: content.acceptanceCriteria,
      requirements: content.requirements,
    }),
    sections: sections.map(({ key, order, materializedMarkdown }) => ({
      key,
      order,
      materializedMarkdown,
    })),
  } satisfies TaskEventContentSnapshot;
}

export function toTaskSnapshot(
  task: TaskSnapshotSource,
  content: TaskEventContentSnapshot,
): TaskCreatedEventPayload['task'] {
  return {
    name: task.name,
    type: task.type,
    description: content.description,
    ...(content.sections !== undefined ? { sections: content.sections } : {}),
    ...(task.tag != null ? { tag: task.tag as FeatureTag } : {}),
    ...(content.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: content.acceptanceCriteria }
      : {}),
    ...(content.requirements !== undefined
      ? { requirements: content.requirements }
      : {}),
    projectId: task.projectId as ProjectId,
    initiativeId: (task.initiativeId ?? undefined) as InitiativeId | undefined,
    status: task.status,
    priority: task.priority as TaskPriority | undefined,
    dueDate: task.dueDate?.toISOString() ?? undefined,
    assigneeId: (task.assigneeId ?? undefined) as UserId | undefined,
    parentTaskId: task.parentTaskId as TaskId,
    id: task.id as TaskId,
    organizationId: task.organizationId as OrganizationId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function buildTaskEventUpdateSnapshot(
  updates: UpdateTaskDto,
): TaskEventUpdateSnapshot {
  const snapshot: TaskEventUpdateSnapshot = {};

  if (updates.name !== undefined) {
    snapshot.name = updates.name;
  }
  if (updates.type !== undefined) {
    snapshot.type = updates.type;
  }
  if (updates.tag !== undefined) {
    snapshot.tag = updates.tag;
  }
  if (updates.status !== undefined) {
    snapshot.status = updates.status;
  }
  if (updates.priority !== undefined) {
    snapshot.priority = updates.priority;
  }
  if (updates.dueDate !== undefined) {
    snapshot.dueDate = updates.dueDate ?? undefined;
  }
  if (updates.assigneeId !== undefined) {
    snapshot.assigneeId = (updates.assigneeId ?? undefined) as
      | UserId
      | undefined;
  }
  if (updates.parentTaskId !== undefined) {
    snapshot.parentTaskId = updates.parentTaskId as TaskId;
  }

  return snapshot;
}

export function extractTaskSectionContent(
  sections?: TaskEventSectionSnapshot[],
): Partial<Record<TaskEventContentField, string>> {
  const content: Partial<Record<TaskEventContentField, string>> = {};
  if (!sections || sections.length === 0) {
    return content;
  }

  for (const section of sections) {
    if (
      TASK_EVENT_CONTENT_FIELDS.includes(
        section.key as TaskEventContentField,
      ) &&
      (typeof section.materializedMarkdown === 'string' ||
        section.materializedMarkdown === null)
    ) {
      content[section.key as TaskEventContentField] =
        section.materializedMarkdown ?? '';
    }
  }

  return content;
}
