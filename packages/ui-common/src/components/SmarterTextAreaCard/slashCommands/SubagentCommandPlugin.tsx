import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
  type LexicalNode,
  type LexicalEditor,
} from "lexical";
import {
  $createSubagentCommandNode,
  $isSubagentCommandNode,
  SubagentCommandNode,
} from "./SubagentCommandNode";
import { REVERT_SUBAGENT_COMMAND } from "./SubagentCommandControl";
import { parseSubagentCommandPrefix } from "./subagentCommand";
import {
  $addUpdateTag,
  $isTextNode,
  $isLineBreakNode,
  HISTORY_PUSH_TAG,
} from "lexical";

function $controlBeforeCaret(): SubagentCommandNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor.getNode();
  const previous = $isParagraphNode(anchor)
    ? anchor.getChildAtIndex(selection.anchor.offset - 1)
    : selection.anchor.offset === 0
      ? anchor.getPreviousSibling()
      : null;
  return $isSubagentCommandNode(previous) ? previous : null;
}

export function $selectSubagentControl(node: SubagentCommandNode): void {
  const selection = $createNodeSelection();
  selection.add(node.getKey());
  $setSelection(selection);
}

function $removeLeadingWhitespace(text: LexicalNode): boolean {
  const paragraph = text.getParent();
  if (!$isParagraphNode(paragraph) || paragraph.getParent() !== $getRoot())
    return false;
  const before = text.getPreviousSiblings();
  const paragraphs = paragraph.getPreviousSiblings();
  const isWhitespace = (node: LexicalNode) =>
    ($isTextNode(node) || $isLineBreakNode(node)) &&
    !node.getTextContent().trim();
  if (
    !before.every(isWhitespace) ||
    !paragraphs.every(
      (node) =>
        $isParagraphNode(node) && node.getChildren().every(isWhitespace),
    )
  )
    return false;
  [...paragraphs, ...before].forEach((node) => node.remove());
  return true;
}

/** Shared by typing, paste and draft restoration; only the first text can convert. */
function $convertSubagentPrefix(text: TextNode): void {
  if (!text.isSimpleText()) return;
  const prefix = parseSubagentCommandPrefix(text.getTextContent());
  if (!prefix || !$removeLeadingWhitespace(text)) return;
  const selection = $getSelection();
  const interactive =
    $isRangeSelection(selection) && selection.anchor.key === text.getKey();
  const command = $createSubagentCommandNode({
    mode: prefix.mode,
    capability: prefix.capability,
  });
  const [trigger] = text.splitText(prefix.length);
  trigger.replace(command);
  if (interactive) $selectSubagentControl(command);
}

export function SubagentCommandPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    // Reverted or relocated command text stays literal until the user edits it.
    const literalText = new Map<string, string>();
    const replaceWithLiteral = (
      node: SubagentCommandNode,
      text: string,
      focus: boolean,
    ) => {
      const replacement = $createTextNode(text).toggleUnmergeable();
      literalText.set(replacement.getKey(), text);
      node.replace(
        node.getParent() === $getRoot()
          ? $createParagraphNode().append(replacement)
          : replacement,
      );
      if (focus) replacement.selectEnd();
    };
    const revert = (node: SubagentCommandNode) => {
      $addUpdateTag(HISTORY_PUSH_TAG);
      replaceWithLiteral(
        node,
        node.getNextSibling() ? "/subagent " : "/subagent",
        true,
      );
    };
    return mergeRegister(
      editor.registerNodeTransform(TextNode, (text) => {
        if (literalText.get(text.getKey()) === text.getTextContent()) return;
        literalText.delete(text.getKey());
        $convertSubagentPrefix(text);
      }),
      editor.registerNodeTransform(SubagentCommandNode, (node) => {
        if (!$removeLeadingWhitespace(node))
          replaceWithLiteral(node, node.getTextContent(), false);
      }),
      registerSubagentNavigation(editor, revert),
    );
  }, [editor]);
  return null;
}

function registerSubagentNavigation(
  editor: LexicalEditor,
  revert: (node: SubagentCommandNode) => void,
): () => void {
  return mergeRegister(
    editor.registerCommand(
      REVERT_SUBAGENT_COMMAND,
      (key) => {
        const node = $getNodeByKey(key);
        if (!$isSubagentCommandNode(node)) return false;
        revert(node);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        const selected = $isNodeSelection(selection)
          ? selection.getNodes()[0]
          : null;
        const node = $isSubagentCommandNode(selected)
          ? selected
          : $controlBeforeCaret();
        if (!node) return false;
        event?.preventDefault();
        revert(node);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (!event.shiftKey) return false;
        const previous = $controlBeforeCaret();
        if (!previous) return false;
        event.preventDefault();
        $selectSubagentControl(previous);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}
