import type { AgentEdge } from '../../generated/graphs';

export interface DiagramViewElement {
  id: string;
  name: string;
  role: string | null;
  canonicalReference: { entityType: string; entityId: string } | null;
  description: string | null;
  groupIds: string[];
}

export interface DiagramViewGroup {
  id: string;
  label: string;
  meaning: string;
  parentGroupId: string | null;
  memberIds: string[];
}

export interface DiagramView {
  id: string;
  name: string;
  description: string | null;
  kind: string | null;
  level: string | null;
  elements: DiagramViewElement[];
  elementsTruncated: boolean;
  flowLinks: AgentEdge[];
  fulfillmentLinks: AgentEdge[];
  contractLinks: AgentEdge[];
  informationalLinks: AgentEdge[];
  groups: DiagramViewGroup[];
}

const ABSENT = '-';
const NONE_RETURNED = '  none returned by this read';
const DESCRIPTION_INDENT = '    ';

// Free text is JSON-quoted so names and predicates stay on one line and cannot
// be mistaken for the field boundaries around them.
const quoted = (value: string): string => JSON.stringify(value);

// Descriptions are the one multi-line text, so they are printed as-is. Each line
// is indented deeper than element lines, so a rebuild strips DESCRIPTION_INDENT
// to recover the authored text and no description line reads as an element.
const descriptionLines = (description: string | null): string[] =>
  description
    ? description.split('\n').map((line) => `${DESCRIPTION_INDENT}${line}`)
    : [];

const idList = (ids: string[]): string =>
  ids.length > 0 ? ids.join(',') : ABSENT;

const endpoint = (
  entityType: string | null | undefined,
  id: string,
  title: string | null | undefined,
): string => {
  const ref = entityType ? `${entityType}:${id}` : id;
  return title ? `${ref} ${quoted(title)}` : ref;
};

const section = (label: string, lines: string[]): string[] => [
  `${label}:`,
  ...(lines.length > 0 ? lines : [NONE_RETURNED]),
];

const elementLine = (element: DiagramViewElement): string => {
  const reference = element.canonicalReference
    ? `${element.canonicalReference.entityType}:${element.canonicalReference.entityId}`
    : ABSENT;
  return `  ${element.id} ${element.role ?? ABSENT} ${quoted(element.name)} ref=${reference} group=${idList(element.groupIds)}`;
};

const flowLine = (edge: AgentEdge): string => {
  const direction = edge.direction ? ` direction=${edge.direction}` : '';
  const predicate = edge.predicate
    ? ` predicate=${quoted(edge.predicate)}`
    : '';
  return `  ${edge.id} ${edge.sourceNodeId} -> ${edge.targetNodeId} ${edge.type}${direction}${predicate}`;
};

const linkLine = (edge: AgentEdge): string =>
  `  ${edge.id} ${edge.sourceNodeId} ${edge.type} ${endpoint(
    edge.targetNodeType ?? edge.targetEntityType,
    edge.targetNodeId,
    edge.targetNodeName,
  )}`;

const groupLine = (group: DiagramViewGroup): string =>
  `  ${group.id} ${quoted(group.label)} ${group.meaning} parent=${group.parentGroupId ?? ABSENT} members=${idList(group.memberIds)}`;

export function renderDiagramView(view: DiagramView): string {
  const elementLines = view.elements.flatMap((element) => [
    elementLine(element),
    ...descriptionLines(element.description),
  ]);
  if (view.elementsTruncated) {
    elementLines.push(
      '  more elements may exist beyond this read; the view is incomplete',
    );
  }
  return [
    `DIAGRAM ${view.id} ${quoted(view.name)} kind=${view.kind ?? ABSENT} level=${view.level ?? ABSENT}`,
    ...descriptionLines(view.description),
    ...section('elements', elementLines),
    ...section('flow', view.flowLinks.map(flowLine)),
    ...section('fulfillment', view.fulfillmentLinks.map(linkLine)),
    ...section('contracts', view.contractLinks.map(linkLine)),
    ...section('links', view.informationalLinks.map(linkLine)),
    ...section('groups', view.groups.map(groupLine)),
    'layout: omitted; replace the whole layout through edit_work_item',
  ].join('\n');
}
