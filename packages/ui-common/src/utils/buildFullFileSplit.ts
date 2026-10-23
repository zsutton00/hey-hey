/**
 * Build aligned split-view rows for a full-file diff from raw pre/post content.
 *
 * Each row corresponds to a single visual row in the split-view renderer:
 *   - `equal`   — line unchanged on both sides
 *   - `insert`  — line added (post-only, oldLine === null)
 *   - `delete`  — line removed (pre-only, newLine === null)
 *   - `replace` — paired removal + addition rendered on the same row
 *
 * Adjacent delete + insert blocks with different line counts are aligned by
 * content. Correlated changed lines become `replace` rows, while unmatched
 * lines remain standalone deletes or inserts.
 *
 * `preContent === null` means the file did not exist before the change (added
 * file): every row is rendered as `insert`. `postContent === null` means the
 * file no longer exists (deleted file): every row is rendered as `delete`.
 */

import { diffArrays, diffLines } from "diff";

type FullFileSplitRowType = "equal" | "insert" | "delete" | "replace";

export interface FullFileSplitRow {
  type: FullFileSplitRowType;
  oldLine: string | null;
  newLine: string | null;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

const splitContentIntoLines = (value: string): string[] => {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
};

const buildAddedFileRows = (postContent: string): FullFileSplitRow[] => {
  const lines = splitContentIntoLines(postContent);
  return lines.map((line, index) => ({
    type: "insert",
    oldLine: null,
    newLine: line,
    oldLineNumber: null,
    newLineNumber: index + 1,
  }));
};

const buildDeletedFileRows = (preContent: string): FullFileSplitRow[] => {
  const lines = splitContentIntoLines(preContent);
  return lines.map((line, index) => ({
    type: "delete",
    oldLine: line,
    newLine: null,
    oldLineNumber: index + 1,
    newLineNumber: null,
  }));
};

const appendEqualRows = (
  rows: FullFileSplitRow[],
  lines: string[],
  cursors: { old: number; new: number },
): void => {
  for (const line of lines) {
    rows.push({
      type: "equal",
      oldLine: line,
      newLine: line,
      oldLineNumber: cursors.old,
      newLineNumber: cursors.new,
    });
    cursors.old += 1;
    cursors.new += 1;
  }
};

const LINE_CORRELATION_THRESHOLD = 0.3;

const tokenizeLine = (line: string): ReadonlySet<string> =>
  new Set(
    (line.match(/[\p{L}\p{N}_$]+/gu) ?? []).map((token) => token.toLowerCase()),
  );

type LineCorrelationComparator = (left: string, right: string) => boolean;

const createLineCorrelationComparator = (): LineCorrelationComparator => {
  const tokenCache = new Map<string, ReadonlySet<string>>();
  const getTokens = (line: string): ReadonlySet<string> => {
    const cached = tokenCache.get(line);
    if (cached) return cached;
    const tokens = tokenizeLine(line);
    tokenCache.set(line, tokens);
    return tokens;
  };

  // Exact lines are already anchors in diffLines. For a changed block whose
  // sides have different lengths, shared identifiers and keywords provide a
  // signal for matching edited lines across an insertion or deletion.
  return (left, right) => {
    const leftTokens = getTokens(left);
    const rightTokens = getTokens(right);
    if (leftTokens.size === 0 || rightTokens.size === 0) return false;

    let sharedTokenCount = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) sharedTokenCount += 1;
    }

    const unionSize = leftTokens.size + rightTokens.size - sharedTokenCount;
    return sharedTokenCount / unionSize >= LINE_CORRELATION_THRESHOLD;
  };
};

const appendReplaceRows = (
  rows: FullFileSplitRow[],
  removedLines: string[],
  addedLines: string[],
  cursors: { old: number; new: number },
): void => {
  const rowCount = Math.max(removedLines.length, addedLines.length);
  for (let index = 0; index < rowCount; index += 1) {
    const removed = removedLines[index];
    const added = addedLines[index];

    if (removed !== undefined && added !== undefined) {
      rows.push({
        type: "replace",
        oldLine: removed,
        newLine: added,
        oldLineNumber: cursors.old,
        newLineNumber: cursors.new,
      });
      cursors.old += 1;
      cursors.new += 1;
      continue;
    }

    if (removed !== undefined) {
      rows.push({
        type: "delete",
        oldLine: removed,
        newLine: null,
        oldLineNumber: cursors.old,
        newLineNumber: null,
      });
      cursors.old += 1;
      continue;
    }

    if (added !== undefined) {
      rows.push({
        type: "insert",
        oldLine: null,
        newLine: added,
        oldLineNumber: null,
        newLineNumber: cursors.new,
      });
      cursors.new += 1;
    }
  }
};

const appendCorrelatedRows = (
  rows: FullFileSplitRow[],
  removedLines: string[],
  addedLines: string[],
  cursors: { old: number; new: number },
): void => {
  if (removedLines.length === addedLines.length) {
    appendReplaceRows(rows, removedLines, addedLines, cursors);
    return;
  }

  const changes = diffArrays(removedLines, addedLines, {
    comparator: createLineCorrelationComparator(),
  });
  const hasCorrelatedLines = changes.some(
    (change) => !change.added && !change.removed,
  );
  if (!hasCorrelatedLines) {
    appendReplaceRows(rows, removedLines, addedLines, cursors);
    return;
  }

  let oldIndex = 0;
  let newIndex = 0;

  for (const change of changes) {
    const changedLines = change.value;
    if (change.added) {
      appendInsertRows(rows, changedLines, cursors);
      newIndex += changedLines.length;
      continue;
    }

    if (change.removed) {
      appendDeleteRows(rows, changedLines, cursors);
      oldIndex += changedLines.length;
      continue;
    }

    for (let index = 0; index < changedLines.length; index += 1) {
      const removed = removedLines[oldIndex];
      const added = addedLines[newIndex];
      if (removed === undefined || added === undefined) continue;

      rows.push({
        type: removed === added ? "equal" : "replace",
        oldLine: removed,
        newLine: added,
        oldLineNumber: cursors.old,
        newLineNumber: cursors.new,
      });
      cursors.old += 1;
      cursors.new += 1;
      oldIndex += 1;
      newIndex += 1;
    }
  }
};

const appendDeleteRows = (
  rows: FullFileSplitRow[],
  lines: string[],
  cursors: { old: number; new: number },
): void => {
  for (const line of lines) {
    rows.push({
      type: "delete",
      oldLine: line,
      newLine: null,
      oldLineNumber: cursors.old,
      newLineNumber: null,
    });
    cursors.old += 1;
  }
};

const appendInsertRows = (
  rows: FullFileSplitRow[],
  lines: string[],
  cursors: { old: number; new: number },
): void => {
  for (const line of lines) {
    rows.push({
      type: "insert",
      oldLine: null,
      newLine: line,
      oldLineNumber: null,
      newLineNumber: cursors.new,
    });
    cursors.new += 1;
  }
};

export const buildFullFileSplit = (
  preContent: string | null,
  postContent: string | null,
): FullFileSplitRow[] => {
  if (preContent === null && postContent === null) {
    return [];
  }
  if (preContent === null) {
    return buildAddedFileRows(postContent ?? "");
  }
  if (postContent === null) {
    return buildDeletedFileRows(preContent);
  }

  const changes = diffLines(preContent, postContent);
  const rows: FullFileSplitRow[] = [];
  const cursors = { old: 1, new: 1 };

  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i];
    const lines = splitContentIntoLines(change.value);

    if (!change.added && !change.removed) {
      appendEqualRows(rows, lines, cursors);
      continue;
    }

    const next = changes[i + 1];
    if (change.removed && next?.added) {
      const nextLines = splitContentIntoLines(next.value);
      appendCorrelatedRows(rows, lines, nextLines, cursors);
      i += 1;
      continue;
    }

    if (change.removed) {
      appendDeleteRows(rows, lines, cursors);
      continue;
    }

    if (change.added) {
      appendInsertRows(rows, lines, cursors);
    }
  }

  return rows;
};
