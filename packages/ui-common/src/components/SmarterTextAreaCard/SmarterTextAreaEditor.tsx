import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { Box, type SxProps, type Theme } from "@mui/material";
import {
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  type EditorState,
} from "lexical";
import React, {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type FocusEventHandler,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useCachedConversationMentionOptions } from "../../data/hooks/useCachedConversationMentionOptions";
import type { FileReferenceScope } from "../../data/hooks/useFileReferenceCandidates";
import { useMentionEntitySearch } from "../../data/hooks/useMentionEntitySearch";
import { EntityDropPlugin } from "./EntityDropPlugin";
import { FeatureReferenceDiscoveryPlugin } from "./FeatureReferenceDiscoveryPlugin";
import { FeatureReferenceMatchNode } from "./FeatureReferenceMatchNode";
import { FEATURE_REFERENCE_DISCOVERY_TAG } from "./featureReferenceDiscovery";
import { MentionEditorContext } from "./EditorContext";
import { MentionNode } from "./MentionNode";
import { RichSlashCommandPlugin } from "./slashCommands/RichSlashCommandPlugin";
import {
  NO_SLASH_FOCAL_ENTITY,
  type AgentComposerContext,
  type SlashFocalEntityState,
} from "./slashCommands/types";
import {
  loadContentWithMentions,
  serializeEditorState,
} from "./serializationUtils";
import { FileReferenceNode } from "./fileReferences/FileReferenceNode";
import { FileReferencePlugin } from "./fileReferences/FileReferencePlugin";
import { SubagentCommandNode } from "./slashCommands/SubagentCommandNode";
import { SubagentCommandPlugin } from "./slashCommands/SubagentCommandPlugin";
import {
  $readSubagentEditorState,
  type SubagentEditorState,
} from "./slashCommands/subagentEditorState";

export interface SmarterTextAreaEditorContext {
  organizationId: string;
  projectId: string;
  conversationId: string | null;
}

export interface SmarterTextAreaEditorReset {
  /** Change this key when the editor should replace its current document. */
  key: string | number;
  /** Serialized rich-text value to load for the reset. */
  value: string;
}

export interface SmarterTextAreaEditorPresentation {
  containerSx?: SxProps<Theme>;
  containerTestId?: string;
  autoFocus?: boolean;
  /** Increment to focus an already-mounted editor from an adjacent control. */
  focusSignal?: number;
  contentEditableTestId?: string;
  contentEditableAriaLabel?: string;
  contentEditableAriaPlaceholder?: string;
  contentEditableStyle?: CSSProperties;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  placeholder?: ReactNode;
  placeholderStyle?: CSSProperties;
}

export interface SmarterTextAreaEditorProps {
  /** Explicitly owned context. Pass null to disable project-aware behavior. */
  context: SmarterTextAreaEditorContext | null;
  /** Initial serialized value; it is read once when the editor mounts. */
  initialValue?: string;
  onChange: (value: string, subagentState: SubagentEditorState) => void;
  fileReferenceScope?: FileReferenceScope | null;
  focalEntity?: SlashFocalEntityState;
  /** Attached provider context enables the Codex-only `/skill` command. */
  agentContext?: AgentComposerContext | null;
  subagentCommandAvailable?: boolean;
  messageAgentCommandAvailable?: boolean;
  /** Optional explanation for showing `/skill` disabled before a Run exists. */
  unavailableSkillCommandReason?: string;
  editable?: boolean;
  submitDisabled?: boolean;
  onSubmit?: () => void;
  reset?: SmarterTextAreaEditorReset;
  rendering?: "rich" | "plain";
  presentation?: SmarterTextAreaEditorPresentation;
}

interface SubmitPluginProps {
  onSubmit?: () => void;
  disabled: boolean;
}

const SubmitPlugin: React.FC<SubmitPluginProps> = ({ onSubmit, disabled }) => {
  const [editor] = useLexicalComposerContext();
  const onSubmitRef = useRef(onSubmit);
  const disabledRef = useRef(disabled);
  onSubmitRef.current = onSubmit;
  disabledRef.current = disabled;

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.isComposing) return false;

        if (
          event &&
          (event.metaKey || event.ctrlKey) &&
          !disabledRef.current &&
          onSubmitRef.current
        ) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    );
  }, [editor]);

  return null;
};

const EditorValuePlugin: React.FC<{
  initialValue?: string;
  reset?: SmarterTextAreaEditorReset;
}> = ({ initialValue, reset }) => {
  const [editor] = useLexicalComposerContext();
  const initializedRef = useRef(false);
  const resetKey = reset?.key;
  const resetValue = reset?.value;
  const resetKeyRef = useRef<string | number | undefined>(resetKey);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      resetKeyRef.current = resetKey;

      if (initialValue !== undefined) {
        editor.update(() => loadContentWithMentions(initialValue), {
          discrete: true,
        });
      }
      return;
    }

    if (resetKey === undefined || resetKey === resetKeyRef.current) return;

    resetKeyRef.current = resetKey;
    if (resetValue === undefined) return;
    // Commit each reset before another submission outcome can replace its value.
    editor.update(() => loadContentWithMentions(resetValue), {
      discrete: true,
    });
  }, [editor, initialValue, resetKey, resetValue]);

  return null;
};

const EditablePlugin: React.FC<{ editable: boolean }> = ({ editable }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  return null;
};

const AutoFocusPlugin: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (enabled) editor.focus();
  }, [editor, enabled]);

  return null;
};

const FocusSignalPlugin: React.FC<{ signal: number | undefined }> = ({
  signal,
}) => {
  const [editor] = useLexicalComposerContext();
  const previousSignalRef = useRef(signal);

  useEffect(() => {
    if (
      signal !== undefined &&
      previousSignalRef.current !== undefined &&
      signal !== previousSignalRef.current
    ) {
      editor.getRootElement()?.focus({ preventScroll: true });
      editor.focus();
    }
    previousSignalRef.current = signal;
  }, [editor, signal]);

  return null;
};

const editorContextValue = (
  context: SmarterTextAreaEditorContext | null,
  navigate: (url: string) => void
): {
  projectId: string;
  organizationId: string;
  navigate: (url: string) => void;
} | null => {
  if (!context?.organizationId || !context.projectId) return null;

  return {
    organizationId: context.organizationId,
    projectId: context.projectId,
    navigate,
  };
};

export const SmarterTextAreaEditor: React.FC<SmarterTextAreaEditorProps> = ({
  context,
  editable = true,
  fileReferenceScope = null,
  focalEntity = NO_SLASH_FOCAL_ENTITY,
  agentContext = null,
  subagentCommandAvailable = false,
  messageAgentCommandAvailable = false,
  unavailableSkillCommandReason,
  initialValue,
  onChange,
  onSubmit,
  presentation,
  rendering = "rich",
  reset,
  submitDisabled = false,
}) => {
  const navigate = useNavigate();
  const organizationId = context?.organizationId ?? null;
  const projectId = context?.projectId ?? null;
  const conversationId = context?.conversationId ?? null;
  const { searchEntities } = useMentionEntitySearch(
    organizationId,
    projectId,
    conversationId
  );
  const cachedConversationMentionOptions =
    useCachedConversationMentionOptions(conversationId);
  const mentionContext = useMemo(
    () => editorContextValue(context, navigate),
    [context, navigate]
  );
  const projectContext = mentionContext
    ? {
        organizationId: mentionContext.organizationId,
        projectId: mentionContext.projectId,
      }
    : null;
  const placeholder = presentation?.placeholder;
  const contentEditableAriaPlaceholder =
    presentation?.contentEditableAriaPlaceholder ??
    (placeholder === undefined
      ? undefined
      : typeof placeholder === "string"
      ? placeholder
      : "");
  const contentEditablePlaceholder =
    placeholder === undefined ? (
      <span />
    ) : (
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          pointerEvents: "none",
          ...presentation?.placeholderStyle,
        }}
      >
        {placeholder}
      </div>
    );
  const initialConfig = useMemo(
    () => ({
      namespace: "SmarterTextAreaEditor",
      nodes: [
        MentionNode,
        FileReferenceNode,
        FeatureReferenceMatchNode,
        SubagentCommandNode,
      ],
      theme: {},
      editable,
      onError: (error: Error) => console.error(error),
    }),
    [editable]
  );

  return (
    <MentionEditorContext.Provider value={mentionContext}>
      <LexicalComposer initialConfig={initialConfig}>
        <Box
          data-testid={presentation?.containerTestId}
          sx={presentation?.containerSx}
        >
          <RichTextPlugin
            contentEditable={
              contentEditableAriaPlaceholder === undefined ? (
                <ContentEditable
                  data-testid={presentation?.contentEditableTestId}
                  aria-label={presentation?.contentEditableAriaLabel}
                  placeholder={null}
                  onFocus={presentation?.onFocus}
                  onBlur={presentation?.onBlur}
                  style={presentation?.contentEditableStyle}
                />
              ) : (
                <ContentEditable
                  data-testid={presentation?.contentEditableTestId}
                  aria-label={presentation?.contentEditableAriaLabel}
                  aria-placeholder={contentEditableAriaPlaceholder}
                  placeholder={contentEditablePlaceholder}
                  onFocus={presentation?.onFocus}
                  onBlur={presentation?.onBlur}
                  style={presentation?.contentEditableStyle}
                />
              )
            }
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <OnChangePlugin
            // Restoration transforms can change routing without changing draft text.
            ignoreHistoryMergeTagChange={false}
            onChange={(state: EditorState, _editor, tags) => {
              if (tags?.has(FEATURE_REFERENCE_DISCOVERY_TAG)) return;

              state.read(() => {
                onChange(serializeEditorState(), $readSubagentEditorState());
              });
            }}
          />
          {/* Project-aware plugins must scan the loaded draft, not the empty document. */}
          <EditorValuePlugin initialValue={initialValue} reset={reset} />
          {subagentCommandAvailable ? <SubagentCommandPlugin /> : null}
          <RichSlashCommandPlugin
            organizationId={organizationId}
            projectId={projectId}
            agentContext={agentContext}
            surfaceContext={{
              focalEntity,
              cachedConversationMentionOptions,
              unavailableSkillCommandReason,
              subagentCommandAvailable,
              messageAgentCommandAvailable,
            }}
            onSearchEntities={searchEntities}
            rendering={rendering}
          />
          {rendering === "rich" && projectContext ? (
            <FeatureReferenceDiscoveryPlugin
              organizationId={projectContext.organizationId}
              projectId={projectContext.projectId}
            />
          ) : null}
          {rendering === "rich" && projectContext && fileReferenceScope ? (
            <FileReferencePlugin
              config={{
                organizationId: projectContext.organizationId,
                projectId: projectContext.projectId,
                scope: fileReferenceScope,
              }}
            />
          ) : null}
          <HistoryPlugin />
          <EntityDropPlugin />
          <EditablePlugin editable={editable} />
          <AutoFocusPlugin enabled={presentation?.autoFocus ?? false} />
          <FocusSignalPlugin signal={presentation?.focusSignal} />
          <SubmitPlugin
            onSubmit={onSubmit}
            disabled={!editable || submitDisabled}
          />
        </Box>
      </LexicalComposer>
    </MentionEditorContext.Provider>
  );
};

export const RichTextEditor = SmarterTextAreaEditor;
