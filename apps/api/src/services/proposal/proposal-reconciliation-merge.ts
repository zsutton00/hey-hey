import type { Prisma } from '@prisma/client';
import { isEqual } from 'lodash';

type Value = Prisma.JsonValue | undefined;

export type ReconciliationMergeResult =
  | { kind: 'MERGED'; candidate: Prisma.JsonValue }
  | { kind: 'AGENT_FIX_REQUIRED'; conflictingPaths: string[] };

type TextEdit = { start: number; end: number; replacement: string };

/** A single contiguous edit is deliberately conservative about ambiguous text. */
function textEdit(baseline: string, changed: string): TextEdit {
  let start = 0;
  while (start < baseline.length && baseline[start] === changed[start]) start++;
  let end = baseline.length;
  let changedEnd = changed.length;
  while (
    end > start &&
    changedEnd > start &&
    baseline[end - 1] === changed[changedEnd - 1]
  ) {
    end--;
    changedEnd--;
  }
  return { start, end, replacement: changed.slice(start, changedEnd) };
}

function mergeText(
  baseline: string,
  current: string,
  proposed: string,
): string | undefined {
  const edits: [TextEdit, TextEdit] = [
    textEdit(baseline, current),
    textEdit(baseline, proposed),
  ];
  edits.sort((a, b) => a.start - b.start);
  const [first, second] = edits;
  // Touching edits, including insertions at the same boundary, need a person.
  if (first.end >= second.start) return undefined;
  return (
    baseline.slice(0, first.start) +
    first.replacement +
    baseline.slice(first.end, second.start) +
    second.replacement +
    baseline.slice(second.end)
  );
}

function isObject(value: Value): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Requirements have durable identities; their positions are presentation only. */
function mergeRequirements(
  baseline: Prisma.JsonArray,
  current: Prisma.JsonArray,
  proposed: Prisma.JsonArray,
  path: string,
  conflicts: string[],
  textPaths: ReadonlySet<string>,
): Prisma.JsonArray {
  const byId = (records: Prisma.JsonArray) =>
    new Map(
      records.map((record) => {
        if (!isObject(record) || typeof record.id !== 'string') {
          throw new Error('Requirement merge requires canonical records.');
        }
        return [record.id, record] as const;
      }),
    );
  const before = byId(baseline);
  const live = byId(current);
  const intended = byId(proposed);
  const merged = new Map<string, Prisma.JsonValue>();
  for (const id of new Set([
    ...before.keys(),
    ...live.keys(),
    ...intended.keys(),
  ])) {
    const requirementPath = `${path}/${id}`;
    const localConflicts: string[] = [];
    const value = mergeValue(
      before.get(id),
      live.get(id),
      intended.get(id),
      requirementPath,
      localConflicts,
      new Set([...textPaths, `${requirementPath}/statement`]),
    );
    if (localConflicts.length) {
      conflicts.push(requirementPath);
    }
    if (value !== undefined) {
      merged.set(id, value);
    }
  }
  const order = [...live.keys()].filter((id) => merged.has(id));
  let predecessor: string | undefined;
  for (const id of intended.keys()) {
    if (!merged.has(id)) {
      continue;
    }
    if (!order.includes(id)) {
      const index = predecessor === undefined ? -1 : order.indexOf(predecessor);
      order.splice(index + 1, 0, id);
    }
    predecessor = id;
  }
  return order.map((id) => merged.get(id)!);
}

function mergeValue(
  baseline: Value,
  current: Value,
  proposed: Value,
  path: string,
  conflicts: string[],
  textPaths: ReadonlySet<string>,
): Value {
  if (isEqual(baseline, proposed)) return current;
  if (isEqual(baseline, current) || isEqual(current, proposed)) return proposed;
  if (
    path === '/sections/requirements/records' &&
    Array.isArray(baseline) &&
    Array.isArray(current) &&
    Array.isArray(proposed)
  ) {
    return mergeRequirements(
      baseline,
      current,
      proposed,
      path,
      conflicts,
      textPaths,
    );
  }
  if (isObject(baseline) && isObject(current) && isObject(proposed)) {
    const candidate: Prisma.JsonObject = {};
    const keys = new Set([
      ...Object.keys(baseline),
      ...Object.keys(current),
      ...Object.keys(proposed),
    ]);
    for (const key of keys) {
      const childPath = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      const value = mergeValue(
        Object.prototype.hasOwnProperty.call(baseline, key)
          ? baseline[key]
          : undefined,
        Object.prototype.hasOwnProperty.call(current, key)
          ? current[key]
          : undefined,
        Object.prototype.hasOwnProperty.call(proposed, key)
          ? proposed[key]
          : undefined,
        childPath,
        conflicts,
        textPaths,
      );
      if (value !== undefined) {
        Object.defineProperty(candidate, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    return candidate;
  }
  if (
    textPaths.has(path) &&
    typeof baseline === 'string' &&
    typeof current === 'string' &&
    typeof proposed === 'string'
  ) {
    const merged = mergeText(baseline, current, proposed);
    if (merged !== undefined) return merged;
  }
  // Ordered arrays are atomic. Merging their positions would invent intent.
  conflicts.push(path);
  return current;
}

/** `/sections/description` → `sections.description`, the field naming reviewers see. */
export function pointerToFieldPath(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.');
}

export function fieldPathToPointer(path: string): string {
  return path
    .split('.')
    .map((segment) => `/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

export function valueAtPointer(value: Value, pointer: string): Value {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<Value>(
      (node, key) =>
        Array.isArray(node)
          ? node.find((entry) => isObject(entry) && entry.id === key)
          : isObject(node) && Object.prototype.hasOwnProperty.call(node, key)
            ? node[key]
            : undefined,
      value,
    );
}

const NON_CONTENT_UPDATE_KEYS = new Set(['reason', 'sectionUpdateSource']);

/** Fields a proposal's `updates` change, in `pointerToFieldPath` naming. */
export function proposalChangedPaths(updates: Prisma.JsonValue): string[] {
  if (!isObject(updates) || 'operations' in updates) return [];
  const paths = new Set<string>();
  for (const [key, value] of Object.entries(updates)) {
    if (NON_CONTENT_UPDATE_KEYS.has(key) || value === undefined) continue;
    if (key === 'sections' && Array.isArray(value)) {
      for (const section of value)
        if (isObject(section) && typeof section.key === 'string')
          paths.add(`sections.${section.key}`);
      continue;
    }
    paths.add(key === 'requirementOps' ? 'requirements' : key);
  }
  return [...paths].sort();
}

/** Compare values semantically; object property order is not a content version. */
export function mergeProposalContent(
  baseline: Prisma.JsonValue,
  current: Prisma.JsonValue,
  proposed: Prisma.JsonValue,
  textPaths: ReadonlySet<string> = new Set(),
): ReconciliationMergeResult {
  const conflicts: string[] = [];
  const candidate = mergeValue(
    baseline,
    current,
    proposed,
    '',
    conflicts,
    textPaths,
  )!;
  return conflicts.length
    ? { kind: 'AGENT_FIX_REQUIRED', conflictingPaths: conflicts }
    : { kind: 'MERGED', candidate };
}
