/**
 * MarkdownLexicalEditor - Simplified markdown editor with controlled mode
 * Supports markdown with real-time shortcuts and controlled initialization
 */

import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { Paper } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type {
  EditorState,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  TextNode,
} from "lexical";
import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  COLLABORATION_TAG,
} from "lexical";
import React, { useCallback, useMemo, useRef } from "react";

// Import Lexical markdown node types
import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";

// Import official Lexical markdown support
import {
  $convertFromMarkdownString as $$convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  type Transformer,
} from "@lexical/markdown";
import { log } from "../../utils/logger";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";
import { MentionNode } from "../SmarterTextAreaCard/MentionNode";
import { EntityDropPlugin } from "../SmarterTextAreaCard/EntityDropPlugin";
import { FileReferencePlugin } from "../SmarterTextAreaCard/fileReferences/FileReferencePlugin";
import { FileReferenceNode } from "../SmarterTextAreaCard/fileReferences/FileReferenceNode";
import type { FileReferenceConfig } from "../SmarterTextAreaCard/fileReferences/types";
import { RichSlashCommandPlugin } from "../SmarterTextAreaCard/slashCommands/RichSlashCommandPlugin";
import { NO_CACHED_CONVERSATION_MENTION_OPTIONS } from "../SmarterTextAreaCard/slashCommands/types";
import type { SlashFocalEntityState } from "../SmarterTextAreaCard/slashCommands/types";
import type {
  EntitySearchScope,
  SearchEntity,
} from "../SmarterTextAreaCard/types";
import { buildMentionAwareTransformers } from "./mentionMarkdownTransformer";
import { buildFileReferenceAwareTransformers } from "./fileReferenceMarkdownTransformer";
import { MarkdownPlugin } from "./plugins/MarkdownPlugin";

// Import diff functionality
import type {
  EditHistoryEntryDto,
  EnhancedDiffResult,
} from "../../utils/textDiff";
import { DiffTextNode } from "./nodes/DiffTextNode";
import { EditHistoryDiffPlugin } from "./plugins/EditHistoryDiffPlugin";
import { FencedCodeOnEnterPlugin } from "./plugins/FencedCodeOnEnterPlugin";
import { ListIndentationPlugin } from "./plugins/ListIndentationPlugin";
import { MarkdownPastePlugin } from "./plugins/MarkdownPastePlugin";

// Helper functions for structured logging migration
const truncateForLogging = (
  content: string | null | undefined,
  maxLength = 50,
): string => {
  if (!content) return "";
  return content.length > maxLength
    ? content.substring(0, maxLength) + "..."
    : content;
};

const prepareDebugData = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const prepared = { ...data };

  // Truncate known content fields
  if (typeof prepared.currentContent === "string") {
    prepared.currentContent = truncateForLogging(prepared.currentContent);
  }
  if (typeof prepared.value === "string") {
    prepared.value = truncateForLogging(prepared.value);
  }
  if (typeof prepared.userContent === "string") {
    prepared.userContent = truncateForLogging(prepared.userContent);
  }
  if (typeof prepared.pendingValue === "string") {
    prepared.pendingValue = truncateForLogging(prepared.pendingValue);
  }

  return prepared;
};

const $convertFromMarkdownString = (
  markdown: string,
  transformers: Transformer[],
) => {
  $$convertFromMarkdownString(markdown, transformers);
};

export interface MarkdownLexicalEditorProps {
  value?: string;
  onTextChange?: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  isLoading: boolean; // Required prop to control initialization timing
  // Attention claude do not ever add `controlledMode` or similar again
  // controlledMode?: booleam; broken, typical Claude dogshit code

  // Diff functionality props
  editHistory?: EditHistoryEntryDto[];
  showEditHistoryDiffs?: boolean;
  isLoadingEditHistory?: boolean;
  onEditHistoryDiffCalculated?: (hasChanges: boolean) => void;
  mentionConfig?: MarkdownLexicalEditorMentionConfig;
  entitySlashConfig?: MarkdownLexicalEditorEntitySlashConfig;
  fileReferenceConfig?: FileReferenceConfig;
}

export interface MarkdownLexicalEditorMentionConfig {
  organizationId: string;
  projectId: string;
  navigate?: (url: string) => void;
}

export interface MarkdownLexicalEditorEntitySlashConfig {
  organizationId: string;
  projectId: string;
  focalEntity: SlashFocalEntityState;
  onSearchEntities: (
    query: string,
    searchScope: EntitySearchScope,
  ) => Promise<SearchEntity[]>;
}

// Plugin to handle text changes with debouncing for performance
function OnChangeTextPlugin({
  onTextChange,
  transformers,
  pendingValueRef,
}: {
  onTextChange?: (text: string) => void;
  transformers: Transformer[];
  pendingValueRef: React.MutableRefObject<string | undefined>;
}) {
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleChange = useCallback(
    (_state: EditorState, editor: LexicalEditor, tags: Set<string>) => {
      log.editorChange("OnChangeTextPlugin.handleChange called");

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      if (!tags.has(COLLABORATION_TAG)) {
        debounceTimeoutRef.current = setTimeout(() => {
          // ⬇️ get the *current* editorState, not the stale one
          editor.getEditorState().read(() => {
            const markdown = $convertToMarkdownString(transformers);
            // Suppress no-op emissions where the markdown matches the canonical
            // post-roundtrip value the editor settled on after the last
            // external sync (or after the last user emit). Without this, lexical's
            // own normalization (e.g. trimming a trailing newline) would echo
            // back through onTextChange right after a server hydration and
            // mark the editor dirty even though no user input occurred.
            if (markdown === pendingValueRef.current) {
              return;
            }
            pendingValueRef.current = markdown;
            log.editorChange("Markdown content", markdown);
            onTextChange?.(markdown);
          });
        }, 300);
      }
    },
    [onTextChange, transformers, pendingValueRef],
  );

  React.useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return <OnChangePlugin onChange={handleChange} />;
}

// Plugin to set initial content - with controlled mode support
function ValueSyncPlugin({
  value,
  isLoading,
  transformers,
  pendingValueRef,
}: {
  value?: string;
  isLoading: boolean;
  transformers: Transformer[];
  pendingValueRef: React.MutableRefObject<string | undefined>;
}) {
  const [editor] = useLexicalComposerContext();
  const hasInitializedRef = useRef(false);

  React.useEffect(() => {
    // Skip all updates while loading - don't initialize yet
    if (isLoading) {
      log.debug("lexical_editor", "🔄 Skipping update - data is loading");
      log.editorInit(
        "MarkdownLexicalEditor ValueSyncPlugin - skipping update, data is loading",
      );
      return;
    }

    // Get current content from editor
    const currentContent = editor
      .getEditorState()
      .read(() => $convertToMarkdownString(transformers));

    const initData = {
      value,
      valueLength: value?.length || 0,
      currentContent,
      currentLength: currentContent?.length || 0,
      contentMatches: value === currentContent,
      hasInitialized: hasInitializedRef.current,
      isLoading,
      triggerReason: "MarkdownLexicalEditor ValueSyncPlugin useEffect",
    };
    log.debug("lexical_editor", "🚨 Value sync", prepareDebugData(initData));
    log.editorInit(
      "MarkdownLexicalEditor ValueSyncPlugin useEffect triggered",
      initData,
    );

    // Only update if content actually differs from editor's current content
    // This handles both initialization and external updates
    if (value !== currentContent) {
      log.debug("lexical_editor", "🔨 Content update - content differs", {
        oldContent: truncateForLogging(currentContent),
        newContent: truncateForLogging(value),
        isInitialization: !hasInitializedRef.current,
      });

      editor.update(
        () => {
          $setSelection(null);
          const root = $getRoot();
          root.clear();

          if (value) {
            // Convert markdown content using official Lexical markdown support
            log.debug("lexical_editor", "🔧 Converting from markdown", {
              value: truncateForLogging(value),
            });
            $convertFromMarkdownString(value, transformers);

            const t = $getRoot().getTextContent();
            log.debug("lexical_editor", "🔧 Converted from markdown", {
              convertedText: truncateForLogging(t),
            });
          }
          // Set cursor to end of content after markdown conversion
          try {
            const lastChild = root.getLastChild();
            if (lastChild) {
              // Try to set selection to the end of the last child
              const rangeSelection = $createRangeSelection();

              // Find the last descendant text node to position cursor
              // Check if lastChild is an ElementNode before calling getLastDescendant
              if (lastChild.__type && "getLastDescendant" in lastChild) {
                const lastDescendant: LexicalNode | null = (
                  lastChild as ElementNode
                ).getLastDescendant();
                if (lastDescendant && lastDescendant.getType() === "text") {
                  const textNode = lastDescendant as TextNode;
                  rangeSelection.setTextNodeRange(
                    textNode,
                    textNode.getTextContentSize(),
                    textNode,
                    textNode.getTextContentSize(),
                  );
                  $setSelection(rangeSelection);
                } else {
                  // Fallback: select at the end of the root content
                  root.selectEnd();
                }
              } else {
                // Fallback: select at the end of the root content
                root.selectEnd();
              }
            }
          } catch (e) {
            // Selection positioning failed, that's okay - content is still loaded
            console.log(
              "Cursor positioning failed after markdown conversion (non-critical)",
            );
          }
        },
        {
          tag: COLLABORATION_TAG,
          discrete: true,
        },
      );
    } else {
      log.debug("lexical_editor", "🚫 Skipping update - content matches");
      // Still mark as initialized if this is the first time and content matches
      if (!hasInitializedRef.current) {
        hasInitializedRef.current = true;
      }
    }

    // Record the canonical post-roundtrip markdown for OnChangeTextPlugin to
    // dedupe normalization-only emissions. This must happen whether or not we
    // ran editor.update — a no-op render still needs the ref aligned with what
    // lexical actually has.
    pendingValueRef.current = editor
      .getEditorState()
      .read(() => $convertToMarkdownString(transformers));
  }, [editor, value, isLoading, transformers, pendingValueRef]);

  return null;
}

export const MarkdownLexicalEditor: React.FC<MarkdownLexicalEditorProps> = ({
  value,
  onTextChange,
  disabled = false,
  placeholder = "",
  isLoading,

  // Diff functionality props
  editHistory,
  showEditHistoryDiffs = false,
  isLoadingEditHistory = false,
  onEditHistoryDiffCalculated,
  mentionConfig,
  entitySlashConfig,
  fileReferenceConfig,
}) => {
  log.editorRender("MARKDOWN EDITOR rendered", {
    value,
    hasValue: !!value,
    valueLength: value?.length || 0,
    showEditHistoryDiffs,
    hasEditHistory: !!editHistory?.length,
  });

  // Tracks the canonical markdown the editor settled on after the most recent
  // external sync (or last user emit). OnChangeTextPlugin reads this to skip
  // emissions that only reflect lexical's own roundtrip normalization.
  const pendingValueRef = useRef<string | undefined>(undefined);

  // Callback handler for diff state changes
  const handleEditHistoryDiffCalculated = useCallback(
    (diffResult: EnhancedDiffResult) => {
      // Extract the boolean values from the diff result object
      const hasChanges = diffResult?.hasChanges ?? false;
      onEditHistoryDiffCalculated?.(hasChanges);
    },
    [onEditHistoryDiffCalculated],
  );
  const theme = useTheme();
  const markdownTransformers = useMemo(
    () =>
      buildFileReferenceAwareTransformers(
        buildMentionAwareTransformers(TRANSFORMERS),
      ),
    [],
  );

  const mentionEditorContextValue = useMemo(() => {
    if (!mentionConfig?.navigate) {
      return null;
    }

    return {
      organizationId: mentionConfig.organizationId,
      projectId: mentionConfig.projectId,
      navigate: mentionConfig.navigate,
    };
  }, [
    mentionConfig?.organizationId,
    mentionConfig?.projectId,
    mentionConfig?.navigate,
  ]);

  const initialConfig: InitialConfigType = useMemo(
    () => ({
      namespace: "MarkdownSuggestionEditor",
      theme: {
        // Custom theme for our editor
        paragraph: "lexical-paragraph",
        text: {
          bold: "lexical-text-bold",
          italic: "lexical-text-italic",
          underline: "lexical-text-underline",
        },
        code: "lexical-code-block",
        heading: {
          h1: "initiative-header initiative-header--level-1",
          h2: "initiative-header initiative-header--level-2",
          h3: "initiative-header initiative-header--level-3",
        },
      },
      onError: (error: Error) => {
        log.error("editor", "MarkdownLexicalEditor Lexical error", error);
        log.error("lexical_editor", "Lexical editor error", { error });
      },
      nodes: [
        // Markdown node types
        HeadingNode,
        QuoteNode,
        CodeNode,
        ListNode,
        ListItemNode,
        LinkNode,
        MentionNode,
        FileReferenceNode,
        // Diff highlighting node
        DiffTextNode,
      ],
      editable: !disabled,
    }),
    [disabled],
  );

  const editorStyles = {
    "& .lexical-paragraph": {
      margin: 0,
      marginBottom: "8px",
      position: "relative",
      "&:last-child": {
        marginBottom: 0,
      },
    },
    "& .lexical-text-bold": {
      fontWeight: "bold",
    },
    "& .lexical-text-italic": {
      fontStyle: "italic",
    },
    "& .lexical-text-underline": {
      textDecoration: "underline",
    },
    // Header Styles - for initiative sections
    "& .initiative-header": {
      margin: "24px 0 16px 0",
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      fontWeight: "500",
      lineHeight: 1.2,
      color: theme.palette.text.primary,
      borderBottom: `1px solid ${theme.palette.divider}`,
      paddingBottom: "8px",
    },
    "& .initiative-header--level-1": {
      fontSize: "2rem",
      marginTop: "32px",
    },
    "& .initiative-header--level-2": {
      fontSize: "1.5rem",
      marginTop: "24px",
    },
    "& .initiative-header--level-3": {
      fontSize: "1.25rem",
      marginTop: "20px",
    },
    // Contenteditable styles
    '& [contenteditable="true"]': {
      outline: "none",
      border: "none",
      resize: "none",
      fontSize: "1rem",
      lineHeight: 1.6,
      fontFamily: "inherit",
      minHeight: "100px",
      padding: "12px",
      caretColor: theme.palette.text.primary,
      "&:focus": {
        outline: "none",
        caretColor: theme.palette.text.primary,
      },
    },
    // Placeholder styles
    "& .lexical-placeholder": {
      position: "absolute",
      top: "12px",
      left: "12px",
      color: theme.palette.text.disabled,
      fontSize: "1rem",
      pointerEvents: "none",
      userSelect: "none",
    },
    // Markdown element styles
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      fontWeight: "600",
      marginTop: "1em",
      marginBottom: "0.5em",
      color: theme.palette.text.primary,
    },
    "& h1": { fontSize: "2em" },
    "& h2": { fontSize: "1.75em" },
    "& h3": { fontSize: "1.5em" },
    "& h4": { fontSize: "1.25em" },
    "& h5": { fontSize: "1.1em" },
    "& h6": { fontSize: "1em" },
    "& ul, & ol": {
      paddingLeft: "1.5em",
      marginTop: "0.5em",
      marginBottom: "0.5em",
    },
    "& li": {
      marginBottom: "0.25em",
    },
    "& blockquote": {
      borderLeft: `4px solid ${theme.palette.primary.main}`,
      paddingLeft: "1em",
      marginLeft: "0",
      marginRight: "0",
      fontStyle: "italic",
      color: theme.palette.text.secondary,
    },
    "& code": {
      backgroundColor:
        theme.palette.mode === "dark"
          ? "rgba(255, 255, 255, 0.1)"
          : "rgba(0, 0, 0, 0.1)",
      padding: "2px 4px",
      borderRadius: "3px",
      fontSize: "0.9em",
      fontFamily: "monospace",
    },
    "& .lexical-code-block": {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      margin: 0,
      backgroundColor:
        theme.palette.mode === "dark"
          ? "rgba(255, 255, 255, 0.05)"
          : "rgba(0, 0, 0, 0.05)",
      padding: "1em",
      borderRadius: "6px",
      minHeight: "1.6em",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflowX: "auto",
      fontFamily: "monospace",
      fontSize: "0.95em",
      lineHeight: 1.6,
    },
    "& pre": {
      backgroundColor:
        theme.palette.mode === "dark"
          ? "rgba(255, 255, 255, 0.05)"
          : "rgba(0, 0, 0, 0.05)",
      padding: "1em",
      borderRadius: "6px",
      overflow: "auto",
      "& code": {
        backgroundColor: "transparent",
        padding: "0",
      },
    },
    "& a": {
      color: theme.palette.primary.main,
      textDecoration: "underline",
      "&:hover": {
        color: theme.palette.primary.dark,
      },
    },
    // Diff highlighting styles
    "& .diff-text": {
      borderRadius: "3px",
      padding: "1px 2px",
      margin: "0 1px",
      position: "relative",
    },
    "& .diff-text--addition": {
      backgroundColor: theme.palette.success.light,
      color: theme.palette.success.contrastText,
      "&.diff-text--system": {
        // System additions - green with slightly different shade
        backgroundColor: theme.palette.success.main,
        opacity: 0.8,
      },
      "&.diff-text--user": {
        // User additions - lighter green
        backgroundColor: theme.palette.success.light,
        opacity: 0.9,
      },
    },
    "& .diff-text--deletion": {
      backgroundColor: theme.palette.error.light,
      color: theme.palette.error.contrastText,
      textDecoration: "line-through",
      "&.diff-text--system": {
        // System deletions - red with slightly different shade
        backgroundColor: theme.palette.error.main,
        opacity: 0.8,
      },
      "&.diff-text--user": {
        // User deletions - lighter red
        backgroundColor: theme.palette.error.light,
        opacity: 0.9,
      },
    },
    "& .diff-text--replacement": {
      backgroundColor: theme.palette.warning.light,
      color: theme.palette.warning.contrastText,
      "&.diff-text--system": {
        // System replacements - yellow with slightly different shade
        backgroundColor: theme.palette.warning.main,
        opacity: 0.8,
      },
      "&.diff-text--user": {
        // User replacements - lighter yellow
        backgroundColor: theme.palette.warning.light,
        opacity: 0.9,
      },
    },
    "& .diff-text--equal": {
      // No special styling for unchanged text
      backgroundColor: "transparent",
    },
  };

  return (
    <MentionEditorContext.Provider value={mentionEditorContextValue}>
      <Paper
        sx={{
          position: "relative",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          backgroundColor: disabled
            ? theme.palette.action.disabledBackground
            : theme.palette.background.default,
          "&:hover": !disabled
            ? {
                borderColor: theme.palette.primary.main,
              }
            : {},
          "&:focus-within": !disabled
            ? {
                borderColor: theme.palette.primary.main,
                boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
              }
            : {},
          ...editorStyles,
        }}
      >
        <LexicalComposer
          initialConfig={initialConfig}
          key={isLoading ? "t" : "f"}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                style={{
                  outline: "none",
                  border: "none",
                  resize: "none",
                }}
                onClick={(e) => {
                  if (process.env.NODE_ENV === "development") {
                    const clickData = {
                      targetTagName: (e.target as HTMLElement).tagName,
                      targetClasses: (e.target as HTMLElement).className,
                      targetTextContent:
                        (e.target as HTMLElement).textContent?.substring(
                          0,
                          50,
                        ) + "...",
                    };
                    log.debug(
                      "lexical_editor",
                      "📍 Content editable clicked",
                      clickData,
                    );
                  }
                }}
              />
            }
            placeholder={
              <div className="lexical-placeholder">{placeholder}</div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />

          <HistoryPlugin />
          <AutoFocusPlugin />
          <ListPlugin />
          <ListIndentationPlugin />
          <FencedCodeOnEnterPlugin />
          <MarkdownPastePlugin transformers={markdownTransformers} />
          <MarkdownPlugin
            enableShortcuts={true}
            transformers={markdownTransformers}
          />
          <EntityDropPlugin />
          {entitySlashConfig && !disabled && (
            <RichSlashCommandPlugin
              organizationId={entitySlashConfig.organizationId}
              projectId={entitySlashConfig.projectId}
              surfaceContext={{
                commandSurface: "entity-insertion-only",
                focalEntity: entitySlashConfig.focalEntity,
                cachedConversationMentionOptions:
                  NO_CACHED_CONVERSATION_MENTION_OPTIONS,
              }}
              onSearchEntities={entitySlashConfig.onSearchEntities}
            />
          )}
          {fileReferenceConfig && !disabled && (
            <FileReferencePlugin config={fileReferenceConfig} />
          )}
          {/* <ListBehaviorPlugin /> */}
          {showEditHistoryDiffs &&
            editHistory &&
            editHistory.length > 0 &&
            !isLoadingEditHistory && (
              <EditHistoryDiffPlugin
                editHistory={editHistory}
                enabled={showEditHistoryDiffs}
                onDiffCalculated={handleEditHistoryDiffCalculated}
              />
            )}
          <OnChangeTextPlugin
            onTextChange={onTextChange}
            transformers={markdownTransformers}
            pendingValueRef={pendingValueRef}
          />
          <ValueSyncPlugin
            value={value}
            isLoading={isLoading}
            transformers={markdownTransformers}
            pendingValueRef={pendingValueRef}
          />
        </LexicalComposer>
      </Paper>
    </MentionEditorContext.Provider>
  );
};
