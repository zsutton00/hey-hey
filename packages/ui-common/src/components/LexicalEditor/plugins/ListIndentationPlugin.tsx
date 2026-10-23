import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { ListItemNode, ListNode } from "@lexical/list";
import { $createListNode, $isListItemNode, $isListNode } from "@lexical/list";
import { $findMatchingParent } from "@lexical/utils";
import type { LexicalNode } from "lexical";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_TAB_COMMAND,
} from "lexical";
import { useEffect } from "react";

const collectListItems = (nodes: LexicalNode[]): ListItemNode[] => {
  const itemsByKey = new Map<string, ListItemNode>();
  for (const node of nodes) {
    const listItem = $findMatchingParent(node, $isListItemNode);
    if (listItem) {
      itemsByKey.set(listItem.getKey(), listItem);
    }
  }
  return Array.from(itemsByKey.values());
};

const ensureNestedList = (
  listItem: ListItemNode,
  listType: ListNode["getListType"] extends () => infer R ? R : never
): ListNode => {
  const firstChild = listItem.getFirstChild();
  if ($isListNode(firstChild)) {
    return firstChild;
  }
  const nestedList = $createListNode(listType);
  listItem.append(nestedList);
  return nestedList;
};

const indentListItemUnderPreviousSibling = (
  listItem: ListItemNode
): boolean => {
  const previousSibling = listItem.getPreviousSibling();
  if (!$isListItemNode(previousSibling)) {
    return false;
  }

  const parentList = listItem.getParent();
  if (!$isListNode(parentList)) {
    return false;
  }

  const nestedList = ensureNestedList(
    previousSibling,
    parentList.getListType()
  );
  nestedList.append(listItem);
  return true;
};

export const ListIndentationPlugin = (): null => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        const listItems = collectListItems(selection.getNodes());
        if (listItems.length === 0) {
          return false;
        }

        const shouldOutdent = event?.shiftKey === true;
        for (const listItem of listItems) {
          if (shouldOutdent) {
            const currentIndent = listItem.getIndent();
            const nextIndent = Math.max(0, currentIndent - 1);
            if (nextIndent !== currentIndent) {
              listItem.setIndent(nextIndent);
            }
            continue;
          }

          const indented = indentListItemUnderPreviousSibling(listItem);
          if (!indented) {
            const currentIndent = listItem.getIndent();
            listItem.setIndent(currentIndent + 1);
          }
        }

        event?.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor]);

  return null;
};
