import type { Prisma } from '@prisma/client';
import { restrictTaskWhere } from 'src/read-restriction/read-policy';
import { DiagramKind } from '@hey-hey/contracts/api/models';
import type { UxFlowMembership } from '@hey-hey/contracts/api/models';
import {
  diagramElementMetadataSchema,
  diagramMetadataSchema,
  parseDiagramJson,
} from './diagram-metadata';

const LIVE = { archivedAt: null, status: { not: 'ARCHIVED' as const } };

const sectionRows = (key: string) => ({
  where: { key },
  select: { materializedMarkdown: true },
});

const UX_FLOW_ELEMENT_SELECT = {
  id: true,
  sections: sectionRows('diagramElementMetadata'),
  parentTask: {
    select: {
      id: true,
      name: true,
      sections: sectionRows('diagramMetadata'),
    },
  },
} satisfies Prisma.TaskSelect;

export type UxFlowElementRow = Prisma.TaskGetPayload<{
  select: typeof UX_FLOW_ELEMENT_SELECT;
}>;

/**
 * Where clause for live Diagram elements, inside a live Diagram, whose metadata
 * mentions any of the entity ids. The text match only narrows candidates; the
 * caller decides on the parsed canonical reference.
 */
export function diagramElementsMentioningWhere(params: {
  organizationId: string;
  projectId: string;
  entityIds: readonly string[];
}) {
  return restrictTaskWhere({
    organizationId: params.organizationId,
    projectId: params.projectId,
    type: 'DIAGRAM_ELEMENT',
    ...LIVE,
    parentTask: { is: { type: 'DIAGRAM', ...LIVE } },
    OR: params.entityIds.map((entityId) => ({
      sections: {
        some: {
          key: 'diagramElementMetadata',
          materializedMarkdown: { contains: entityId },
        },
      },
    })),
  } satisfies Prisma.TaskWhereInput);
}

/**
 * Query for live Diagram elements whose metadata mentions the work item. The
 * text match only narrows candidates; `uxFlowMembershipsFromElements` decides.
 */
export function uxFlowElementsQuery(params: {
  organizationId: string;
  projectId: string;
  workItemId: string;
}) {
  return {
    where: diagramElementsMentioningWhere({
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityIds: [params.workItemId],
    }),
    select: UX_FLOW_ELEMENT_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  } satisfies Prisma.TaskFindManyArgs;
}

function parseSection<T>(
  section: { materializedMarkdown: string | null } | undefined,
  parse: (value: unknown) => T | undefined,
): T | undefined {
  if (!section?.materializedMarkdown) {
    return undefined;
  }

  return parse(parseDiagramJson(section.materializedMarkdown));
}

/**
 * The UX flow Diagrams (one entry each, by name) with an element that
 * canonically references the work item.
 */
export function uxFlowMembershipsFromElements(
  elements: readonly UxFlowElementRow[],
  workItemId: string,
): UxFlowMembership[] {
  const memberships = new Map<string, UxFlowMembership>();

  for (const element of elements) {
    const diagram = element.parentTask;
    const reference = parseSection(
      element.sections[0],
      (value) => diagramElementMetadataSchema.safeParse(value).data,
    )?.canonicalReference;
    const kind = parseSection(
      diagram?.sections[0],
      (value) => diagramMetadataSchema.safeParse(value).data,
    )?.kind;
    const referencesWorkItem =
      reference?.entityType === 'TASK' && reference.entityId === workItemId;

    if (
      diagram &&
      kind === DiagramKind.UxFlow &&
      referencesWorkItem &&
      !memberships.has(diagram.id)
    ) {
      memberships.set(diagram.id, {
        diagramId: diagram.id,
        diagramName: diagram.name,
        elementId: element.id,
      });
    }
  }

  return [...memberships.values()].sort((left, right) =>
    left.diagramName.localeCompare(right.diagramName),
  );
}
