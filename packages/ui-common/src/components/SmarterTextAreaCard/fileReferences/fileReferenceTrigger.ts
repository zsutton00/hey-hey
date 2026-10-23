import type { FileReferenceTriggerMatch } from "./types";

export const matchFileReferenceTrigger = (
  text: string,
  caretOffset: number,
  nodeKey = ""
): FileReferenceTriggerMatch | null => {
  if (caretOffset < 0 || caretOffset > text.length) return null;

  const prefix = text.slice(0, caretOffset);
  const atIndex = prefix.lastIndexOf("@");
  if (atIndex < 0) return null;

  const characterBefore = atIndex === 0 ? null : prefix[atIndex - 1];
  if (characterBefore !== null && !/\s/.test(characterBefore)) return null;

  const query = prefix.slice(atIndex + 1);
  if (/\s|@/.test(query)) return null;

  return {
    query,
    range: { nodeKey, sliceStart: atIndex, cursorOffset: caretOffset },
  };
};
