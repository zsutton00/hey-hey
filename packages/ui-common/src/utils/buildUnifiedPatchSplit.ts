import type { FullFileSplitRow } from "./buildFullFileSplit";

interface HunkHeader {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const parseHunkHeader = (line: string): HunkHeader | null => {
  const match = HUNK_HEADER.exec(line);
  if (!match) return null;

  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  };
};

const addEditRows = (
  rows: FullFileSplitRow[],
  removed: string[],
  added: string[],
  cursors: { old: number; new: number },
): void => {
  const pairCount = Math.min(removed.length, added.length);

  for (let index = 0; index < pairCount; index += 1) {
    rows.push({
      type: "replace",
      oldLine: removed[index]!,
      newLine: added[index]!,
      oldLineNumber: cursors.old,
      newLineNumber: cursors.new,
    });
    cursors.old += 1;
    cursors.new += 1;
  }

  for (let index = pairCount; index < removed.length; index += 1) {
    rows.push({
      type: "delete",
      oldLine: removed[index]!,
      newLine: null,
      oldLineNumber: cursors.old,
      newLineNumber: null,
    });
    cursors.old += 1;
  }

  for (let index = pairCount; index < added.length; index += 1) {
    rows.push({
      type: "insert",
      oldLine: null,
      newLine: added[index]!,
      oldLineNumber: null,
      newLineNumber: cursors.new,
    });
    cursors.new += 1;
  }

  removed.length = 0;
  added.length = 0;
};

/** Build split rows from only the lines present in a saved unified patch. */
export const buildUnifiedPatchSplit = (patch: string): FullFileSplitRow[] => {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const rows: FullFileSplitRow[] = [];
  let previousHunk: HunkHeader | null = null;
  let index = 0;

  while (index < lines.length) {
    const header = parseHunkHeader(lines[index]!);
    index += 1;
    if (!header) continue;

    if (!previousHunk) {
      const omittedBeforeFirstHunk = Math.max(
        header.oldStart > 0 ? header.oldStart - 1 : 0,
        header.newStart > 0 ? header.newStart - 1 : 0,
      );
      if (omittedBeforeFirstHunk > 0) {
        rows.push({
          type: "gap",
          oldLine: null,
          newLine: null,
          oldLineNumber: null,
          newLineNumber: null,
          gapLabel: `… ${String(omittedBeforeFirstHunk)} unchanged lines omitted …`,
        });
      }
    } else {
      const omittedOld =
        header.oldStart - previousHunk.oldStart - previousHunk.oldCount;
      const omittedNew =
        header.newStart - previousHunk.newStart - previousHunk.newCount;
      const omitted = Math.max(omittedOld, omittedNew);
      if (omitted > 0) {
        rows.push({
          type: "gap",
          oldLine: null,
          newLine: null,
          oldLineNumber: null,
          newLineNumber: null,
          gapLabel: `… ${String(omitted)} unchanged lines omitted …`,
        });
      }
    }

    const cursors = {
      old: header.oldStart === 0 ? 1 : header.oldStart,
      new: header.newStart === 0 ? 1 : header.newStart,
    };
    const removed: string[] = [];
    const added: string[] = [];

    while (index < lines.length && !lines[index]!.startsWith("@@ ")) {
      const line = lines[index]!;
      index += 1;

      if (line.startsWith("diff --git ")) break;
      if (line.startsWith("\\")) continue;

      if (line.startsWith("+")) {
        added.push(line.slice(1));
      } else if (line.startsWith("-")) {
        removed.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        addEditRows(rows, removed, added, cursors);
        const content = line.slice(1);
        rows.push({
          type: "equal",
          oldLine: content,
          newLine: content,
          oldLineNumber: cursors.old,
          newLineNumber: cursors.new,
        });
        cursors.old += 1;
        cursors.new += 1;
      }
    }

    addEditRows(rows, removed, added, cursors);
    previousHunk = header;
  }

  return rows;
};
