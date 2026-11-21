import { Kind, type GraphQLResolveInfo, type SelectionSetNode } from 'graphql';

function collectFieldNames(
  selectionSet: SelectionSetNode | undefined,
  info: GraphQLResolveInfo,
  names: Set<string>,
  path: readonly string[],
): void {
  if (!selectionSet) {
    return;
  }

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      collectFieldNames(selection.selectionSet, info, names, path);
      continue;
    }

    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragment = info.fragments[selection.name.value];
      collectFieldNames(fragment?.selectionSet, info, names, path);
      continue;
    }

    const [head, ...rest] = path;
    if (head === undefined) {
      names.add(selection.name.value);
      continue;
    }

    if (selection.name.value === head) {
      collectFieldNames(selection.selectionSet, info, names, rest);
    }
  }
}

/**
 * Names of the fields the query selects beneath the current field, after
 * following `path` (e.g. `['nodes']`). Fragments are expanded.
 */
export function selectedFieldNames(
  info: GraphQLResolveInfo,
  path: readonly string[] = [],
): Set<string> {
  const names = new Set<string>();

  for (const fieldNode of info.fieldNodes) {
    collectFieldNames(fieldNode.selectionSet, info, names, path);
  }

  return names;
}
