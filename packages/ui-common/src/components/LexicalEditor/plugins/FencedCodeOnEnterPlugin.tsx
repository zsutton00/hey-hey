import { $createCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type ElementNode,
  type LexicalNode,
  $isTextNode,
} from "lexical";
import { useEffect } from "react";
import { log } from "../../../utils/logger";

type CodeFenceLanguage = string & { readonly __brand: "CodeFenceLanguage" };

interface CodeFenceStart {
  language: CodeFenceLanguage | null;
}

const CODE_FENCE_START_PATTERN = /^[ \t]*```([A-Za-z0-9_-]+)?[ \t]*$/;

export const parseCodeFenceStart = (line: string): CodeFenceStart | null => {
  const match = line.match(CODE_FENCE_START_PATTERN);
  if (!match) {
    return null;
  }

  const languageMatch = match[1]?.trim();
  return {
    language: languageMatch ? (languageMatch as CodeFenceLanguage) : null,
  };
};

const getNodeTextLength = (node: LexicalNode): number => {
  if ($isLineBreakNode(node)) {
    return 1;
  }
  return node.getTextContentSize();
};

const appendTextWithLineBreaks = (
  paragraph: ElementNode,
  text: string
): void => {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) {
      paragraph.append($createLineBreakNode());
    }
    const line = lines[index];
    if (line.length > 0) {
      paragraph.append($createTextNode(line));
    }
  }
};

export const FencedCodeOnEnterPlugin = (): null => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        if (!$isTextNode(anchorNode)) {
          return false;
        }

        const topLevelElement = anchorNode.getTopLevelElement();
        if (topLevelElement === null) {
          return false;
        }

        const paragraph = topLevelElement;
        if (!$isParagraphNode(paragraph)) {
          return false;
        }

        let absoluteCursorOffset = selection.anchor.offset;
        let sibling: LexicalNode | null = anchorNode.getPreviousSibling();
        while (sibling) {
          absoluteCursorOffset += getNodeTextLength(sibling);
          sibling = sibling.getPreviousSibling();
        }

        const paragraphText = paragraph.getTextContent();
        const textBeforeCursor = paragraphText.slice(0, absoluteCursorOffset);
        const textAfterCursor = paragraphText.slice(absoluteCursorOffset);
        const currentLinePrefix = textBeforeCursor.split("\n").pop() ?? "";
        const currentLineSuffix = textAfterCursor.split("\n")[0] ?? "";

        if (currentLineSuffix.trim().length > 0) {
          return false;
        }

        const fenceStart = parseCodeFenceStart(currentLinePrefix);
        if (!fenceStart) {
          if (
            paragraphText.trimStart().startsWith("```") ||
            paragraphText.includes("\n```")
          ) {
            log.debug(
              "lexical_editor",
              "FencedCodeOnEnterPlugin: Enter pressed but line did not match a fence start",
              { paragraphText, currentLinePrefix, currentLineSuffix }
            );
          }
          return false;
        }

        const lineStartIndex =
          textBeforeCursor.length - currentLinePrefix.length;
        const lineEndIndex = absoluteCursorOffset + currentLineSuffix.length;
        const prefixText = paragraphText.slice(0, lineStartIndex);
        const suffixText = paragraphText.slice(lineEndIndex);
        const normalizedPrefix = prefixText.endsWith("\n")
          ? prefixText.slice(0, -1)
          : prefixText;
        const normalizedSuffix = suffixText.startsWith("\n")
          ? suffixText.slice(1)
          : suffixText;

        log.debug(
          "lexical_editor",
          "FencedCodeOnEnterPlugin: converting fence start to code block",
          {
            paragraphText,
            currentLinePrefix,
            language: fenceStart.language,
            hasPrefix: normalizedPrefix.length > 0,
            hasSuffix: normalizedSuffix.length > 0,
          }
        );

        const codeNode = $createCodeNode(fenceStart.language ?? undefined);
        if (normalizedPrefix.length === 0 && normalizedSuffix.length === 0) {
          paragraph.replace(codeNode);
        } else if (normalizedPrefix.length === 0) {
          paragraph.insertBefore(codeNode);
          paragraph.clear();
          appendTextWithLineBreaks(paragraph, normalizedSuffix);
        } else if (normalizedSuffix.length === 0) {
          paragraph.clear();
          appendTextWithLineBreaks(paragraph, normalizedPrefix);
          paragraph.insertAfter(codeNode);
        } else {
          paragraph.clear();
          appendTextWithLineBreaks(paragraph, normalizedPrefix);
          paragraph.insertAfter(codeNode);
          const suffixParagraph = $createParagraphNode();
          appendTextWithLineBreaks(suffixParagraph, normalizedSuffix);
          codeNode.insertAfter(suffixParagraph);
        }

        codeNode.selectStart();
        event?.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
};
