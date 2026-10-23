import { $createTextNode, $getNodeByKey, $isTextNode } from "lexical";
import { $createFileReferenceNode } from "./FileReferenceNode";
import type {
  FileReferenceTextRange,
  FileReferenceValueV1,
} from "./types";

const isValidRange = (
  range: FileReferenceTextRange,
  textLength: number
): boolean =>
  range.sliceStart >= 0 &&
  range.cursorOffset > range.sliceStart &&
  range.cursorOffset <= textLength;

export const $replaceRangeWithFileReference = (
  range: FileReferenceTextRange,
  expectedQuery: string,
  value: FileReferenceValueV1
): boolean => {
  const anchorNode = $getNodeByKey(range.nodeKey);
  if (!$isTextNode(anchorNode)) return false;

  const text = anchorNode.getTextContent();
  if (!isValidRange(range, text.length)) return false;
  if (text.slice(range.sliceStart, range.cursorOffset) !== `@${expectedQuery}`) {
    return false;
  }

  const beforeSlice = text.slice(0, range.sliceStart);
  const textAfterCursor = text.slice(range.cursorOffset);
  anchorNode.setTextContent(beforeSlice);

  const fileReferenceNode = $createFileReferenceNode(value);
  anchorNode.insertAfter(fileReferenceNode);

  const trailingText =
    textAfterCursor.length > 0 && /^\s/.test(textAfterCursor)
      ? textAfterCursor
      : ` ${textAfterCursor}`;
  const trailingTextNode = $createTextNode(trailingText);
  fileReferenceNode.insertAfter(trailingTextNode);
  trailingTextNode.select(1, 1);
  return true;
};
