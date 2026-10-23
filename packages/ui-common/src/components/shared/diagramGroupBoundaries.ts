import type {
  DiagramGroup,
  DiagramGroupColor,
  DiagramGroupMeaning,
  DiagramGroupsValue,
  WorkItemGraphLayoutNodeRef,
} from "../../api";

export const DIAGRAM_GROUPS_SCHEMA_VERSION = "diagram-groups.v1" as const;
export const DIAGRAM_GROUPS_SECTION_KEY = "diagramGroups";

/** Space between a boundary edge and the boxes it encloses. */
export const DIAGRAM_BOUNDARY_PADDING = 24;
/** Header band reserved for the boundary label. */
export const DIAGRAM_BOUNDARY_LABEL_HEIGHT = 24;

export const DIAGRAM_GROUP_COLOR_ORDER = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "teal",
] as const satisfies readonly DiagramGroupColor[];

export function isDiagramGroupColor(
  value: unknown
): value is DiagramGroupColor {
  return DIAGRAM_GROUP_COLOR_ORDER.some((color) => color === value);
}

/** Resolve all groups before deriving visible boxes so every surface agrees. */
export function resolveDiagramGroupColors(
  groups: readonly DiagramGroup[]
): ReadonlyMap<string, DiagramGroupColor> {
  const resolved = new Map<string, DiagramGroupColor>();
  const authored = new Set<DiagramGroupColor>();
  for (const group of groups) {
    if (group.color !== undefined) {
      resolved.set(group.id, group.color);
      authored.add(group.color);
    }
  }
  const available = DIAGRAM_GROUP_COLOR_ORDER.filter(
    (color) => !authored.has(color)
  );
  const automatic = groups
    .filter((group) => group.color === undefined)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  automatic.forEach((group, index) => {
    const color =
      index < available.length
        ? available[index]!
        : DIAGRAM_GROUP_COLOR_ORDER[
            (index - available.length) % DIAGRAM_GROUP_COLOR_ORDER.length
          ]!;
    resolved.set(group.id, color);
  });
  return resolved;
}

const MEANINGS: readonly DiagramGroupMeaning[] = [
  "VISUAL_ASSOCIATION",
  "STRUCTURAL_BOUNDARY",
  "DEPLOYMENT_BOUNDARY",
];

export const isFactualDiagramGroup = (
  group: Pick<DiagramGroup, "meaning">
): boolean => group.meaning !== "VISUAL_ASSOCIATION";

/**
 * Lenient read-side parse: invalid groups or members are dropped rather than
 * failing the whole Diagram, because the server already validated writes and
 * old Diagrams carry no section at all.
 */
export function parseDiagramGroups(value: unknown): DiagramGroup[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { schemaVersion?: unknown }).schemaVersion !==
      DIAGRAM_GROUPS_SCHEMA_VERSION ||
    !Array.isArray((raw as { groups?: unknown }).groups)
  ) {
    return [];
  }
  return ((raw as { groups: unknown[] }).groups ?? []).flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const group = candidate as Record<string, unknown>;
    if (
      typeof group.id !== "string" ||
      typeof group.label !== "string" ||
      !MEANINGS.includes(group.meaning as DiagramGroupMeaning) ||
      !Array.isArray(group.members)
    ) {
      return [];
    }
    return [
      {
        id: group.id,
        label: group.label,
        meaning: group.meaning as DiagramGroupMeaning,
        ...(isDiagramGroupColor(group.color) ? { color: group.color } : {}),
        ...(typeof group.parentGroupId === "string"
          ? { parentGroupId: group.parentGroupId }
          : {}),
        members: group.members.filter(isNodeRef),
      },
    ];
  });
}

const isNodeRef = (value: unknown): value is WorkItemGraphLayoutNodeRef => {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    (ref.kind === "persistedWorkItem" && typeof ref.workItemId === "string") ||
    (ref.kind === "temporaryWorkItem" && typeof ref.temporaryRef === "string")
  );
};

export function serializeDiagramGroups(
  groups: readonly DiagramGroup[]
): DiagramGroupsValue {
  return {
    schemaVersion: DIAGRAM_GROUPS_SCHEMA_VERSION,
    groups: groups.map((group) => ({
      id: group.id,
      label: group.label,
      meaning: group.meaning,
      ...(group.color !== undefined ? { color: group.color } : {}),
      ...(group.parentGroupId ? { parentGroupId: group.parentGroupId } : {}),
      members: group.members.map((member) =>
        member.kind === "persistedWorkItem"
          ? { kind: member.kind, workItemId: member.workItemId }
          : { kind: member.kind, temporaryRef: member.temporaryRef }
      ),
    })),
  };
}

/**
 * Member refs use API identity (persisted/temporary) while rendered nodes use
 * surface IDs: a bare UUID for materialized reads and `existing:` or
 * `temporary:` keys for projected proposals and drafts.
 */
export function resolveDiagramGroupMemberNodeId(
  member: WorkItemGraphLayoutNodeRef,
  nodeIds: ReadonlySet<string>
): string | undefined {
  const candidates =
    member.kind === "persistedWorkItem"
      ? [member.workItemId, `existing:${member.workItemId}`]
      : [`temporary:${member.temporaryRef}`, member.temporaryRef];
  return candidates.find((candidate) => nodeIds.has(candidate));
}

export interface DiagramBoundaryNodeRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramBoundaryBox {
  id: string;
  label: string;
  meaning: DiagramGroupMeaning;
  factual: boolean;
  color: DiagramGroupColor;
  depth: number;
  parentGroupId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rendered node IDs inside this group or any descendant group. */
  memberNodeIds: readonly string[];
  /** Non-members whose saved position falls inside a factual boundary. */
  intrudingNodeIds: readonly string[];
}

/**
 * Draw boxes around wherever members currently sit. Positions are only read,
 * never adjusted, so metadata edits cannot reflow a saved layout. Boxes are
 * returned outermost first so callers can paint inner boxes on top.
 */
export function computeBoundaryBoxes(
  groups: readonly DiagramGroup[],
  nodes: readonly DiagramBoundaryNodeRect[]
): DiagramBoundaryBox[] {
  const colors = resolveDiagramGroupColors(groups);
  const rects = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(rects.keys());
  const byId = new Map(groups.map((group) => [group.id, group]));
  const children = new Map<string, DiagramGroup[]>();
  for (const group of groups) {
    const parent =
      group.parentGroupId && byId.has(group.parentGroupId)
        ? group.parentGroupId
        : undefined;
    if (!parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), group]);
  }

  const boxes = new Map<string, DiagramBoundaryBox>();
  const visiting = new Set<string>();
  const build = (
    group: DiagramGroup,
    depth: number
  ): DiagramBoundaryBox | undefined => {
    if (visiting.has(group.id)) return undefined;
    visiting.add(group.id);
    const ownNodeIds = group.members.flatMap((member) => {
      const id = resolveDiagramGroupMemberNodeId(member, nodeIds);
      return id ? [id] : [];
    });
    const childBoxes = (children.get(group.id) ?? []).flatMap((child) => {
      const box = build(child, depth + 1);
      return box ? [box] : [];
    });
    visiting.delete(group.id);
    const extents = [...ownNodeIds.map((id) => rects.get(id)!), ...childBoxes];
    if (extents.length === 0) return undefined;
    const left = Math.min(...extents.map((rect) => rect.x));
    const top = Math.min(...extents.map((rect) => rect.y));
    const right = Math.max(...extents.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...extents.map((rect) => rect.y + rect.height));
    const box: DiagramBoundaryBox = {
      id: group.id,
      label: group.label,
      meaning: group.meaning,
      factual: isFactualDiagramGroup(group),
      color: colors.get(group.id)!,
      depth,
      ...(group.parentGroupId && byId.has(group.parentGroupId)
        ? { parentGroupId: group.parentGroupId }
        : {}),
      x: left - DIAGRAM_BOUNDARY_PADDING,
      y: top - DIAGRAM_BOUNDARY_PADDING - DIAGRAM_BOUNDARY_LABEL_HEIGHT,
      width: right - left + DIAGRAM_BOUNDARY_PADDING * 2,
      height:
        bottom -
        top +
        DIAGRAM_BOUNDARY_PADDING * 2 +
        DIAGRAM_BOUNDARY_LABEL_HEIGHT,
      memberNodeIds: [
        ...new Set([
          ...ownNodeIds,
          ...childBoxes.flatMap((child) => child.memberNodeIds),
        ]),
      ].sort(),
      intrudingNodeIds: [],
    };
    boxes.set(group.id, box);
    return box;
  };
  for (const group of groups) {
    if (!group.parentGroupId || !byId.has(group.parentGroupId)) {
      build(group, 0);
    }
  }

  return [...boxes.values()]
    .map((box) => {
      if (!box.factual) return box;
      const members = new Set(box.memberNodeIds);
      const intrudingNodeIds = nodes
        .filter((node) => {
          if (members.has(node.id)) return false;
          const cx = node.x + node.width / 2;
          const cy = node.y + node.height / 2;
          return (
            cx > box.x &&
            cx < box.x + box.width &&
            cy > box.y &&
            cy < box.y + box.height
          );
        })
        .map((node) => node.id)
        .sort();
      return { ...box, intrudingNodeIds };
    })
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
}

/**
 * Serializable layout hints: each node's innermost factual boundary
 * (mandatory containment) and visual association groups (soft proximity).
 */
export interface DiagramLayoutGroupHints {
  boundaries: ReadonlyArray<{ id: string; parentId?: string }>;
  /** Node id -> innermost factual boundary id. */
  boundaryOf: Readonly<Record<string, string>>;
  associations: ReadonlyArray<{ id: string; nodeIds: readonly string[] }>;
}

export function buildDiagramLayoutGroupHints(
  groups: readonly DiagramGroup[],
  nodeIds: ReadonlySet<string>
): DiagramLayoutGroupHints | undefined {
  if (groups.length === 0) return undefined;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const factualAncestor = (parentId: string | undefined) => {
    const seen = new Set<string>();
    let current = parentId ? byId.get(parentId) : undefined;
    while (current && !isFactualDiagramGroup(current)) {
      if (seen.has(current.id)) return undefined;
      seen.add(current.id);
      current = current.parentGroupId
        ? byId.get(current.parentGroupId)
        : undefined;
    }
    return current?.id;
  };
  const factual = groups.filter(isFactualDiagramGroup);
  const boundaries = factual
    .map((group) => {
      const parentId = factualAncestor(group.parentGroupId);
      return { id: group.id, ...(parentId ? { parentId } : {}) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const boundaryOf: Record<string, string> = {};
  for (const group of factual) {
    for (const member of group.members) {
      const id = resolveDiagramGroupMemberNodeId(member, nodeIds);
      if (id && boundaryOf[id] === undefined) boundaryOf[id] = group.id;
    }
  }
  const associations = groups
    .filter((group) => !isFactualDiagramGroup(group))
    .map((group) => ({
      id: group.id,
      nodeIds: group.members
        .flatMap((member) => {
          const id = resolveDiagramGroupMemberNodeId(member, nodeIds);
          return id ? [id] : [];
        })
        .sort(),
    }))
    .filter((association) => association.nodeIds.length > 1)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (Object.keys(boundaryOf).length === 0 && associations.length === 0) {
    return undefined;
  }
  return { boundaries, boundaryOf, associations };
}

// Editing helpers shared by the groups panel and its tests.

export const DIAGRAM_GROUP_MEANING_LABELS: Record<DiagramGroupMeaning, string> =
  {
    VISUAL_ASSOCIATION: "Visual association",
    STRUCTURAL_BOUNDARY: "Structural boundary",
    DEPLOYMENT_BOUNDARY: "Deployment boundary",
  };

export const diagramGroupMemberKey = (member: WorkItemGraphLayoutNodeRef) =>
  member.kind === "persistedWorkItem"
    ? `existing:${member.workItemId}`
    : `temporary:${member.temporaryRef}`;

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group";

/** Stable id derived once at creation; later label edits never change it. */
export function allocateDiagramGroupId(
  label: string,
  groups: readonly DiagramGroup[]
): string {
  const taken = new Set(groups.map((group) => group.id));
  const base = `g-${slug(label)}`.slice(0, 100);
  let candidate = base;
  for (let index = 2; taken.has(candidate); index += 1) {
    candidate = `${base}-${index}`;
  }
  return candidate;
}

/** Children of a removed group move to its parent, or to the top level. */
export function removeDiagramGroup(
  groups: readonly DiagramGroup[],
  groupId: string
): DiagramGroup[] {
  const removed = groups.find((group) => group.id === groupId);
  return groups
    .filter((group) => group.id !== groupId)
    .map((group) => {
      if (group.parentGroupId !== groupId) return group;
      const { parentGroupId: _removed, ...rest } = group;
      return removed?.parentGroupId
        ? { ...rest, parentGroupId: removed.parentGroupId }
        : rest;
    });
}

/**
 * Factual boundaries are exclusive at the direct-member level, so adding an
 * element to one moves it out of any other factual boundary.
 */
export function addDiagramGroupMembers(
  groups: readonly DiagramGroup[],
  groupId: string,
  members: readonly WorkItemGraphLayoutNodeRef[]
): DiagramGroup[] {
  const target = groups.find((group) => group.id === groupId);
  if (!target) return [...groups];
  const keys = new Set(members.map(diagramGroupMemberKey));
  const factual = isFactualDiagramGroup(target);
  return groups.map((group) => {
    if (group.id === groupId) {
      const existing = new Set(group.members.map(diagramGroupMemberKey));
      return {
        ...group,
        members: [
          ...group.members,
          ...members.filter(
            (member) => !existing.has(diagramGroupMemberKey(member))
          ),
        ],
      };
    }
    if (factual && isFactualDiagramGroup(group)) {
      return {
        ...group,
        members: group.members.filter(
          (member) => !keys.has(diagramGroupMemberKey(member))
        ),
      };
    }
    return group;
  });
}

export function removeDiagramGroupMembers(
  groups: readonly DiagramGroup[],
  groupId: string,
  members: readonly WorkItemGraphLayoutNodeRef[]
): DiagramGroup[] {
  const keys = new Set(members.map(diagramGroupMemberKey));
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          members: group.members.filter(
            (member) => !keys.has(diagramGroupMemberKey(member))
          ),
        }
      : group
  );
}

/** Parents that keep nesting acyclic and factual boundaries out of visual groups. */
export function eligibleDiagramGroupParents(
  groups: readonly DiagramGroup[],
  group: DiagramGroup
): DiagramGroup[] {
  const descendants = new Set([group.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of groups) {
      if (
        candidate.parentGroupId &&
        descendants.has(candidate.parentGroupId) &&
        !descendants.has(candidate.id)
      ) {
        descendants.add(candidate.id);
        grew = true;
      }
    }
  }
  return groups.filter(
    (candidate) =>
      !descendants.has(candidate.id) &&
      (!isFactualDiagramGroup(group) || isFactualDiagramGroup(candidate))
  );
}
