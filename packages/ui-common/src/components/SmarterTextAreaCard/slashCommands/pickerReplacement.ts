import { $createTextNode, $getNodeByKey, $isTextNode } from "lexical";
import type { PickerReplacementRange } from "./types";

const isValidReplacementRange = (
  range: PickerReplacementRange,
  textLength: number,
): boolean =>
  range.sliceStart >= 0 &&
  range.sliceStart <= textLength &&
  range.cursorOffset >= range.sliceStart &&
  range.cursorOffset <= textLength;

export const $replaceRangeWithText = (
  range: PickerReplacementRange,
  insertedText: string,
): void => {
  const anchorNode = $getNodeByKey(range.nodeKey);
  if (!$isTextNode(anchorNode)) return;

  const text = anchorNode.getTextContent();
  if (!isValidReplacementRange(range, text.length)) return;

  const beforeSlice = text.slice(0, range.sliceStart);
  const textAfterCursor = text.slice(range.cursorOffset);

  anchorNode.setTextContent(beforeSlice);

  const insertedTextNode = $createTextNode(`${insertedText}${textAfterCursor}`);
  anchorNode.insertAfter(insertedTextNode);
  insertedTextNode.select(insertedText.length, insertedText.length);
};
