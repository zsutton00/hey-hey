import {
  $createTextNode,
  $getNodeByKey,
  $isTextNode,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { $createMentionNode } from "./MentionNode";
import type { EntityMention, SearchEntity } from "./types";
import type { PickerReplacementRange } from "./slashCommands/types";

type RecentSelectionRecorder = (
  entity: Pick<SearchEntity, "id" | "type" | "name">,
) => void;

type CanonicalMentionInsertionTarget =
  | {
      kind: "text-range";
      range: PickerReplacementRange;
      surroundingTextPolicy: "append-trailing-space";
    }
  | {
      kind: "exact-text-node";
      nodeKey: string;
      expectedText: string;
      surroundingTextPolicy: "preserve";
      validateCurrentNode: (node: TextNode) => boolean;
    };

interface InsertCanonicalMentionInput {
  editor: LexicalEditor;
  mention: EntityMention;
  recordRecentSelection: RecentSelectionRecorder;
  target: CanonicalMentionInsertionTarget;
}

export function restoreEditorFocus(editor: LexicalEditor): void {
  queueMicrotask(() => {
    editor.focus();
    editor.getRootElement()?.focus({ preventScroll: true });
  });
}

function isValidRange(
  range: PickerReplacementRange,
  textLength: number,
): boolean {
  return (
    range.sliceStart >= 0 &&
    range.sliceStart <= textLength &&
    range.cursorOffset >= range.sliceStart &&
    range.cursorOffset <= textLength
  );
}

function $insertAtTextRange(
  range: PickerReplacementRange,
  mention: EntityMention,
): boolean {
  const sourceNode = $getNodeByKey(range.nodeKey);
  if (!$isTextNode(sourceNode)) return false;

  const text = sourceNode.getTextContent();
  if (!isValidRange(range, text.length)) return false;

  sourceNode.setTextContent(text.slice(0, range.sliceStart));
  const mentionNode = $createMentionNode(mention);
  sourceNode.insertAfter(mentionNode);

  const trailingTextNode = $createTextNode(
    ` ${text.slice(range.cursorOffset)}`,
  );
  mentionNode.insertAfter(trailingTextNode);
  trailingTextNode.select(1, 1);
  return true;
}

function $replaceExactTextNode(
  target: Extract<CanonicalMentionInsertionTarget, { kind: "exact-text-node" }>,
  mention: EntityMention,
): boolean {
  const sourceNode = $getNodeByKey(target.nodeKey);
  if (
    !$isTextNode(sourceNode) ||
    sourceNode.getTextContent() !== target.expectedText ||
    !target.validateCurrentNode(sourceNode)
  ) {
    return false;
  }

  const mentionNode = $createMentionNode(mention);
  const nextSibling = sourceNode.getNextSibling();
  sourceNode.replace(mentionNode);
  if ($isTextNode(nextSibling)) {
    const leadingWhitespace =
      nextSibling.getTextContent().match(/^\s*/u)?.[0].length ?? 0;
    nextSibling.select(leadingWhitespace, leadingWhitespace);
  } else {
    const caretNode = $createTextNode("");
    mentionNode.insertAfter(caretNode);
    caretNode.select(0, 0);
  }
  return true;
}

export function insertCanonicalMention({
  editor,
  mention,
  recordRecentSelection,
  target,
}: InsertCanonicalMentionInput): boolean {
  let inserted = false;
  editor.update(
    () => {
      inserted =
        target.kind === "text-range"
          ? $insertAtTextRange(target.range, mention)
          : $replaceExactTextNode(target, mention);
    },
    { discrete: true, tag: SKIP_DOM_SELECTION_TAG },
  );

  if (!inserted) return false;

  recordRecentSelection({
    id: mention.entityId,
    type: mention.entityType,
    name: mention.entityName,
  });
  restoreEditorFocus(editor);
  return true;
}
