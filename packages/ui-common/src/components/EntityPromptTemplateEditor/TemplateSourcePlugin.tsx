import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  CUT_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type LexicalEditor,
} from "lexical";
import { useEffect, useRef } from "react";
import {
  $loadTemplateSource,
  $templateNodes,
  serializeTemplateSource,
  splitTemplateSource,
} from "./templateSerialization";
import type { TemplateSource } from "./types";

export function TemplateSourcePlugin({
  source,
  readOnly,
  onChange,
}: {
  source: TemplateSource;
  readOnly: boolean;
  onChange: (content: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  useEffect(() => {
    if (serializeTemplateSource(editor.getEditorState()) === source.content)
      return;
    editor.update(
      () => $loadTemplateSource(source.content, source.syntaxVersion),
      { tag: "template-reset" }
    );
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [editor, source.content, source.syntaxVersion]);
  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(
          ({ editorState, tags, dirtyElements, dirtyLeaves }) => {
            if (
              tags.has("template-reset") ||
              (dirtyElements.size === 0 && dirtyLeaves.size === 0)
            )
              return;
            onChangeRef.current(serializeTemplateSource(editorState));
          }
        ),
        registerSubstitutionRecognition(editor, source.syntaxVersion),
        registerTemplateClipboard(editor, source.syntaxVersion)
      ),
    [editor, source.syntaxVersion]
  );
  return null;
}

function registerSubstitutionRecognition(
  editor: LexicalEditor,
  syntaxVersion: TemplateSource["syntaxVersion"]
) {
  return editor.registerNodeTransform(TextNode, (node) => {
    if (node.getType() !== "text" || node.isComposing()) return;
    const segments = splitTemplateSource(node.getTextContent(), syntaxVersion);
    const tokenIndex = segments.findIndex((segment) => segment.substitution);
    if (tokenIndex < 0) return;
    const start = segments
      .slice(0, tokenIndex)
      .reduce((sum, part) => sum + part.source.length, 0);
    const end = start + segments[tokenIndex].source.length;
    const parts = node.splitText(start, end);
    const target = parts[start === 0 ? 0 : 1];
    target.replace(
      $templateNodes(segments[tokenIndex].source, syntaxVersion)[0]
    );
  });
}

function registerTemplateClipboard(
  editor: LexicalEditor,
  syntaxVersion: TemplateSource["syntaxVersion"]
) {
  return mergeRegister(
    editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (
          !editor.isEditable() ||
          !("clipboardData" in event) ||
          !event.clipboardData
        )
          return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        event.preventDefault();
        selection.insertNodes(
          $templateNodes(
            event.clipboardData.getData("text/plain"),
            syntaxVersion
          )
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH
    ),
    ...[COPY_COMMAND, CUT_COMMAND].map((command) =>
      editor.registerCommand(
        command,
        (event) => {
          if (!event || !("clipboardData" in event) || !event.clipboardData)
            return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event.preventDefault();
          event.clipboardData.setData("text/plain", selection.getTextContent());
          if (command === CUT_COMMAND && editor.isEditable())
            selection.removeText();
          return true;
        },
        COMMAND_PRIORITY_HIGH
      )
    )
  );
}
