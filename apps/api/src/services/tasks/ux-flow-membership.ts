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
 * Query for live Diagram elements whose metadata mentions the work item. The
 * text match only narrows candidates; `uxFlowMembershipsFromElements` decides.
 */
export function uxFlowElementsQuery(params: {
  organizationId: string;
  projectId: string;
  workItemId: string;
}) {
  return {
    where: restrictTaskWhere({
      organizationId: params.organizationId,
      projectId: params.projectId,
      type: 'DIAGRAM_ELEMENT',
      ...LIVE,
      parentTask: { is: { type: 'DIAGRAM', ...LIVE } },
      sections: {
        some: {
          key: 'diagramElementMetadata',
          materializedMarkdown: { contains: params.workItemId },
        },
      },
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
