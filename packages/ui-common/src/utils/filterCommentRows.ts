/**
 * Drop comment-only rows from a built full-file split diff.
 *
 * The filter works on `FullFileSplitRow[]` produced by `buildFullFileSplit`,
 * never on raw content, so every surviving row keeps its original
 * `oldLineNumber` / `newLineNumber` and the underlying diff data is untouched.
 *
 * A row is removed when its visible side(s) are wholly comments:
 *   - `equal` / `replace` — both sides are visible, so the row is dropped only
 *     when both the old and the new line are comments;
 *   - `insert` — dropped when the new (added) line is a comment;
 *   - `delete` — dropped when the old (removed) line is a comment.
 *
 * Single-line comments are always considered. When `preContent` /
 * `postContent` are supplied, multi-line block comments are considered too:
 * a side is a comment when its line number falls wholly inside a block
 * comment on that side of the file.
 */

import type { FullFileSplitRow } from "./buildFullFileSplit";
import {
  computeBlockCommentLines,
  isSingleLineCommentLine,
} from "./commentSyntax";

export const filterCommentRows = (
  rows: FullFileSplitRow[],
  filePath: string,
  preContent?: string | null,
  postContent?: string | null
): FullFileSplitRow[] => {
  const blockOldLines =
    preContent != null
      ? computeBlockCommentLines(preContent, filePath)
      : new Set<number>();
  const blockNewLines =
    postContent != null
      ? computeBlockCommentLines(postContent, filePath)
      : new Set<number>();

  const oldSideIsComment = (row: FullFileSplitRow): boolean => {
    if (row.oldLine === null) return false;
    if (isSingleLineCommentLine(row.oldLine, filePath)) return true;
    return row.oldLineNumber !== null && blockOldLines.has(row.oldLineNumber);
  };

  const newSideIsComment = (row: FullFileSplitRow): boolean => {
    if (row.newLine === null) return false;
    if (isSingleLineCommentLine(row.newLine, filePath)) return true;
    return row.newLineNumber !== null && blockNewLines.has(row.newLineNumber);
  };

  return rows.filter((row) => {
    switch (row.type) {
      case "equal":
      case "replace":
        return !(oldSideIsComment(row) && newSideIsComment(row));
      case "insert":
        return !newSideIsComment(row);
      case "delete":
        return !oldSideIsComment(row);
      default:
        return true;
    }
  });
};
