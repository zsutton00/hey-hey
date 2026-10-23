import { InternalServerErrorException } from '@nestjs/common';
import { HelpNode } from 'src/generated';

export type HelpNodeTreeRow = HelpNode;

export function buildHelpTreeItems(rows: HelpNodeTreeRow[]): HelpNode[] {
  const childrenByParentId = groupRowsByParentId(rows);
  const roots = sortSiblingRows(childrenByParentId.get(null) ?? []);
  const visited = new Set<string>();
  const items = flattenHelpNodeRows(roots, childrenByParentId, visited);

  if (visited.size !== rows.length) {
    throw new InternalServerErrorException(
      'help_node rows must form a rooted acyclic tree',
    );
  }

  return items;
}

function groupRowsByParentId(
  rows: HelpNodeTreeRow[],
): Map<string | null, HelpNodeTreeRow[]> {
  return rows.reduce((groups, row) => {
    const siblings = groups.get(row.parentId) ?? [];
    siblings.push(row);
    groups.set(row.parentId, siblings);
    return groups;
  }, new Map<string | null, HelpNodeTreeRow[]>());
}

function flattenHelpNodeRows(
  rows: HelpNodeTreeRow[],
  childrenByParentId: Map<string | null, HelpNodeTreeRow[]>,
  visited: Set<string>,
): HelpNode[] {
  return rows.flatMap((row) => {
    if (visited.has(row.id)) {
      throw new InternalServerErrorException(
        'help_node rows must form a rooted acyclic tree',
      );
    }

    visited.add(row.id);
    const node = toHelpNode(row);
    const children = sortSiblingRows(childrenByParentId.get(row.id) ?? []);
    return [node, ...flattenHelpNodeRows(children, childrenByParentId, visited)];
  });
}

function sortSiblingRows(rows: HelpNodeTreeRow[]): HelpNodeTreeRow[] {
  return [...rows].sort(compareHelpNodeSiblings);
}

function compareHelpNodeSiblings(
  left: HelpNodeTreeRow,
  right: HelpNodeTreeRow,
): number {
  return (
    left.ordering - right.ordering ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function toHelpNode(row: HelpNodeTreeRow): HelpNode {
  return {
    id: row.id,
    parentId: row.parentId,
    slug: row.slug,
    title: row.title,
    ordering: row.ordering,
  } satisfies HelpNode;
}
