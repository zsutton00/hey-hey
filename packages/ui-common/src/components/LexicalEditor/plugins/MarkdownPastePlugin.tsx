import {
  $convertFromMarkdownString,
  TRANSFORMERS,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type PasteCommandType,
} from "lexical";
import React from "react";

interface MarkdownPastePluginProps {
  transformers?: Transformer[];
}

interface MarkdownSelectionContext {
  editorTextContent: string;
  selectedTextContent: string;
  hasExpandedSelection: boolean;
}

const MARKDOWN_MIME_TYPES = ["text/markdown", "text/x-markdown"] as const;

const MARKDOWN_BLOCK_PATTERN =
  /(^|\n)\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|```|~~~|\|.+\||-{3,}\s*$|_{3,}\s*$|\*{3,}\s*$)/m;
const MARKDOWN_INLINE_PATTERN =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]]+\]\(([^)]+)\))/;

export const looksLikeMarkdownDocument = (value: string): boolean => {
  const text = value.trim();
  if (text.length === 0) {
    return false;
  }

  if (MARKDOWN_BLOCK_PATTERN.test(text)) {
    return true;
  }

  return text.includes("\n") && MARKDOWN_INLINE_PATTERN.test(text);
};

export const shouldImportMarkdownDocumentPaste = (
  markdown: string,
  context: MarkdownSelectionContext
): boolean => {
  if (!looksLikeMarkdownDocument(markdown)) {
    return false;
  }

  const editorText = context.editorTextContent.trim();
  if (editorText.length === 0) {
    return true;
  }

  if (!context.hasExpandedSelection) {
    return false;
  }

  return context.selectedTextContent === context.editorTextContent;
};

const getClipboardMarkdown = (event: ClipboardEvent): string | null => {
  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return null;
  }

  for (const mimeType of MARKDOWN_MIME_TYPES) {
    const markdown = clipboardData.getData(mimeType).trim();
    if (markdown.length > 0) {
      return markdown;
    }
  }

  const text = clipboardData.getData("text/plain").trim();
  if (text.length === 0 || !looksLikeMarkdownDocument(text)) {
    return null;
  }

  return text;
};

const isClipboardEvent = (
  event: PasteCommandType | null
): event is ClipboardEvent => {
  return (
    typeof ClipboardEvent !== "undefined" && event instanceof ClipboardEvent
  );
};

export const MarkdownPastePlugin: React.FC<MarkdownPastePluginProps> = ({
  transformers = TRANSFORMERS,
}) => {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!isClipboardEvent(event)) {
          return false;
        }

        const markdown = getClipboardMarkdown(event);
        if (!markdown) {
          return false;
        }

        const shouldImport = editor.getEditorState().read(() => {
          const selection = $getSelection();
          const isExpandedSelection =
            $isRangeSelection(selection) && !selection.isCollapsed();
          const rootTextContent = $getRoot().getTextContent();
          const selectedTextContent = $isRangeSelection(selection)
            ? selection.getTextContent()
            : "";

          return shouldImportMarkdownDocumentPaste(markdown, {
            editorTextContent: rootTextContent,
            selectedTextContent,
            hasExpandedSelection: isExpandedSelection,
          });
        });

        if (!shouldImport) {
          return false;
        }

        event.preventDefault();
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          $convertFromMarkdownString(markdown, transformers);

          if (root.getChildrenSize() === 0) {
            root.append($createParagraphNode());
          }

          root.selectEnd();
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, transformers]);

  return null;
};
