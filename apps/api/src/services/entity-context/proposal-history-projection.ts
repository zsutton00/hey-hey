import type { ContextProposalFieldChangeDto } from 'src/generated/model/contextProposalFieldChangeDto';
import type { ContextProposalSummaryDto } from 'src/generated/model/contextProposalSummaryDto';
import type { TypedProposalResponse } from 'src/services/proposal/proposal.types';

type StablePathValue = {
  path: string;
  type: ContextProposalFieldChangeDto.TypeEnum;
  value: unknown;
};

type HistoricalProposal = {
  id: string;
  createdAt: string;
  targetEntityId: string;
  updates: unknown;
};

type SequenceEdit<T> = {
  operation: 'equal' | 'add' | 'delete';
  value: T;
};

type BoundedDiff = {
  diff: string;
  diffTruncated: boolean;
  diffOmittedCharacters: number;
};

const MARKDOWN_PREVIEW_CHARACTERS = 400;
const DIFF_CHARACTERS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStablePaths(updates: unknown): StablePathValue[] {
  if (!isRecord(updates)) return [];

  const normalized: StablePathValue[] = [];
  for (const key of Object.keys(updates).sort()) {
    const value = updates[key];
    if (key !== 'sections' || !Array.isArray(value)) {
      normalized.push({ path: key, type: classifyValue(value), value });
      continue;
    }

    for (const section of value) {
      if (
        !isRecord(section) ||
        typeof section['key'] !== 'string' ||
        !Object.prototype.hasOwnProperty.call(section, 'content')
      ) {
        continue;
      }
      normalized.push({
        path: `sections.${section['key']}.content`,
        type: 'markdown',
        value: section['content'],
      });
    }
  }

  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function stablePathMap(updates: unknown): Map<string, StablePathValue> {
  return new Map(
    normalizeStablePaths(updates).map((entry) => [entry.path, entry]),
  );
}

function diffSequence<T>(
  previous: readonly T[],
  proposed: readonly T[],
  equals: (left: T, right: T) => boolean,
): SequenceEdit<T>[] {
  const lengths = Array.from({ length: previous.length + 1 }, () =>
    Array<number>(proposed.length + 1).fill(0),
  );
  for (let oldIndex = previous.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = proposed.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex]![newIndex] = equals(
        previous[oldIndex]!,
        proposed[newIndex]!,
      )
        ? lengths[oldIndex + 1]![newIndex + 1]! + 1
        : Math.max(
            lengths[oldIndex + 1]![newIndex]!,
            lengths[oldIndex]![newIndex + 1]!,
          );
    }
  }

  const edits: SequenceEdit<T>[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < previous.length && newIndex < proposed.length) {
    if (equals(previous[oldIndex]!, proposed[newIndex]!)) {
      edits.push({ operation: 'equal', value: previous[oldIndex]! });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      lengths[oldIndex + 1]![newIndex]! >= lengths[oldIndex]![newIndex + 1]!
    ) {
      edits.push({ operation: 'delete', value: previous[oldIndex]! });
      oldIndex += 1;
    } else {
      edits.push({ operation: 'add', value: proposed[newIndex]! });
      newIndex += 1;
    }
  }
  while (oldIndex < previous.length) {
    edits.push({ operation: 'delete', value: previous[oldIndex]! });
    oldIndex += 1;
  }
  while (newIndex < proposed.length) {
    edits.push({ operation: 'add', value: proposed[newIndex]! });
    newIndex += 1;
  }
  return edits;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function classifyValue(value: unknown): ContextProposalFieldChangeDto.TypeEnum {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function serializeValue(
  value: unknown,
  type: ContextProposalFieldChangeDto.TypeEnum,
): string {
  if (type === 'markdown') return String(value);
  const serialized = JSON.stringify(sortJson(value), null, 2);
  return serialized === undefined ? String(value) : serialized;
}

export function deterministicUnifiedDiff(
  previous: string,
  proposed: string,
): BoundedDiff {
  if (previous === proposed) {
    return { diff: '', diffTruncated: false, diffOmittedCharacters: 0 };
  }

  const previousLines = splitLines(previous);
  const proposedLines = splitLines(proposed);
  const edits = diffSequence(previousLines, proposedLines, (a, b) => a === b);

  let oldLine = 1;
  let newLine = 1;
  const diffChunks: string[] = [];

  for (let index = 0; index < edits.length; ) {
    const edit = edits[index]!;
    if (edit.operation === 'equal') {
      oldLine += 1;
      newLine += 1;
      index += 1;
      continue;
    }

    const oldStart = oldLine;
    const newStart = newLine;
    const deleted: string[] = [];
    const added: string[] = [];
    while (index < edits.length && edits[index]!.operation !== 'equal') {
      const changed = edits[index]!;
      if (changed.operation === 'delete') {
        deleted.push(changed.value);
        oldLine += 1;
      } else {
        added.push(changed.value);
        newLine += 1;
      }
      index += 1;
    }

    const oldHeaderStart =
      deleted.length === 0 ? Math.max(0, oldStart - 1) : oldStart;
    const newHeaderStart =
      added.length === 0 ? Math.max(0, newStart - 1) : newStart;
    diffChunks.push(
      [
        `@@ -${oldHeaderStart},${deleted.length} +${newHeaderStart},${added.length} @@`,
        ...deleted.map((line) => `-${line}`),
        ...added.map((line) => `+${line}`),
      ].join('\n'),
    );
  }

  const fullDiff = diffChunks.join('\n');
  const diff = fullDiff.slice(0, DIFF_CHARACTERS);
  return {
    diff,
    diffTruncated: diff.length < fullDiff.length,
    diffOmittedCharacters: fullDiff.length - diff.length,
  };
}

export function summarizeProposalUpdates(
  proposedUpdates: unknown,
  olderProposals: readonly HistoricalProposal[],
): ContextProposalFieldChangeDto[] {
  const olderPaths = olderProposals.map((proposal) => ({
    proposal,
    paths: stablePathMap(proposal.updates),
  }));

  return normalizeStablePaths(proposedUpdates).map((entry) => {
    const matched = olderPaths.find(({ paths }) => paths.has(entry.path));
    const prior = matched?.paths.get(entry.path);
    const shared = {
      path: entry.path,
      type: entry.type,
    };

    const proposedText = serializeValue(entry.value, entry.type);
    if (prior) {
      return {
        ...shared,
        ...deterministicUnifiedDiff(
          serializeValue(prior.value, entry.type),
          proposedText,
        ),
      } satisfies ContextProposalFieldChangeDto;
    }

    return {
      ...shared,
      unavailableReason:
        olderProposals.length === 0
          ? 'no-older-proposal'
          : 'no-same-path-in-window',
      searchedProposalCount: olderProposals.length,
      ...(entry.type === 'markdown'
        ? {
            proposedPreview: proposedText.slice(0, MARKDOWN_PREVIEW_CHARACTERS),
            proposedLength: proposedText.length,
            proposedPreviewTruncated:
              proposedText.length > MARKDOWN_PREVIEW_CHARACTERS,
          }
        : {}),
    } satisfies ContextProposalFieldChangeDto;
  });
}

export function projectContextProposalSummaries(
  visibleProposals: readonly TypedProposalResponse[],
  comparisonProposals: readonly HistoricalProposal[],
): ContextProposalSummaryDto[] {
  return visibleProposals.map((proposal) => {
    const { updates, ...metadata } = proposal;
    const position = comparisonProposals.findIndex(
      (candidate) => candidate.id === proposal.id,
    );
    return {
      ...metadata,
      changes: summarizeProposalUpdates(
        updates,
        position < 0
          ? []
          : comparisonProposals
              .slice(position + 1)
              .filter(
                (candidate) =>
                  candidate.targetEntityId === proposal.targetEntityId,
              ),
      ),
    } satisfies ContextProposalSummaryDto;
  });
}
