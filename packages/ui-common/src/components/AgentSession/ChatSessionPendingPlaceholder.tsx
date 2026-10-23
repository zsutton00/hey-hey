import {
  Alert,
  Box,
  IconButton,
  LinearProgress,
  Tooltip,
  useTheme,
} from "@mui/material";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  type EditorState,
} from "lexical";
import { SystemMessage } from "../Conversation/Components/SystemMessage";
import { MentionNode } from "../SmarterTextAreaCard/MentionNode";
import { EntityDropPlugin } from "../SmarterTextAreaCard/EntityDropPlugin";
import { RichSlashCommandPlugin } from "../SmarterTextAreaCard/slashCommands/RichSlashCommandPlugin";
import { NO_CACHED_CONVERSATION_MENTION_OPTIONS } from "../SmarterTextAreaCard/slashCommands/types";
import { serializeEditorState } from "../SmarterTextAreaCard/serializationUtils";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";
import { useMentionEntitySearch } from "../../data/hooks/useMentionEntitySearch";
import { useProjectIds } from "../../hooks/useEditorContext";

interface ChatSessionPendingPlaceholderProps {
  message: string;
  onSubmit?: (message: string) => Promise<void>;
  /**
   * When true, keeps the bubble mounted, disables the input and send button,
   * and renders a thin progress bar below the bubble. Used to signal that the
   * agent session / conversation / run is being created without ever replacing
   * the placeholder with a full-panel spinner.
   */
  isLoading?: boolean;
}

interface SubmitPluginProps {
  onSubmit: () => void;
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
        if (event && (event.metaKey || event.ctrlKey) && !disabledRef.current) {
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

interface InternalEditorProps {
  onChange: (value: string) => void;
  organizationId: string | null;
  projectId: string | null;
  onSubmit: () => void;
  disabled: boolean;
  editable: boolean;
}

const InternalEditor: React.FC<InternalEditorProps> = ({
  onChange,
  organizationId,
  projectId,
  onSubmit,
  disabled,
  editable,
}) => {
  const [editor] = useLexicalComposerContext();
  const { searchEntities } = useMentionEntitySearch(
    organizationId,
    projectId,
    null
  );

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  return (
    <>
      <OnChangePlugin
        onChange={(state: EditorState) => {
          state.read(() => {
            const serialized = serializeEditorState();
            onChange(serialized);
          });
        }}
      />
      <RichSlashCommandPlugin
        organizationId={organizationId}
        projectId={projectId}
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions:
            NO_CACHED_CONVERSATION_MENTION_OPTIONS,
        }}
        onSearchEntities={searchEntities}
      />
      <EntityDropPlugin />
      <HistoryPlugin />
      <SubmitPlugin onSubmit={onSubmit} disabled={disabled} />
    </>
  );
};

export const ChatSessionPendingPlaceholder: React.FC<
  ChatSessionPendingPlaceholderProps
> = ({ message, onSubmit, isLoading = false }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const editorContextData = useProjectIds();
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const editorKeyRef = useRef(0);

  const trimmed = draft.trim();
  const isBusy = isSubmitting || isLoading;
  const canSubmit = trimmed.length > 0 && !isBusy && !!onSubmit;

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current || !trimmed || !onSubmit) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [trimmed, onSubmit]);

  const contextValue = editorContextData
    ? {
        projectId: editorContextData.projectId,
        organizationId: editorContextData.organizationId,
        navigate,
      }
    : null;

  return (
    <Box>
      <SystemMessage
        type="session-pending"
        text={message}
        animationType="minimal"
      />
      {isBusy && (
        <Box sx={{ px: 2, pb: 1 }} data-testid="chat-session-pending-loading">
          <LinearProgress />
        </Box>
      )}
      {onSubmit && (
        <MentionEditorContext.Provider value={contextValue}>
          <Box
            sx={{
              px: 2,
              pb: 2,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            {error && <Alert severity="error">{error}</Alert>}
            <LexicalComposer
              key={editorKeyRef.current}
              initialConfig={{
                namespace: "ChatSessionPendingPlaceholder",
                nodes: [MentionNode],
                theme: {},
                onError: (e) => console.error(e),
                editable: !isBusy,
              }}
            >
              <Box
                sx={{
                  position: "relative",
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  "&:focus-within": {
                    borderColor: theme.palette.primary.main,
                    borderWidth: 2,
                    margin: "-1px",
                  },
                }}
              >
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      data-testid="chat-session-pending-input"
                      style={{
                        outline: "none",
                        padding: "16.5px 14px",
                        minHeight: "84px",
                        fontSize: "1rem",
                        lineHeight: 1.5,
                        fontFamily: "inherit",
                      }}
                    />
                  }
                  placeholder={
                    <div
                      style={{
                        position: "absolute",
                        top: "16.5px",
                        left: "14px",
                        color: theme.palette.text.secondary,
                        pointerEvents: "none",
                        fontSize: "1rem",
                        lineHeight: 1.5,
                        fontFamily: "inherit",
                      }}
                    >
                      Type your first message…
                    </div>
                  }
                  ErrorBoundary={LexicalErrorBoundary}
                />
                <InternalEditor
                  onChange={setDraft}
                  organizationId={editorContextData?.organizationId ?? null}
                  projectId={editorContextData?.projectId ?? null}
                  onSubmit={() => {
                    void handleSubmit();
                  }}
                  disabled={!canSubmit}
                  editable={!isBusy}
                />
              </Box>
            </LexicalComposer>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Tooltip title="Send (⌘+Enter)">
                <span>
                  <IconButton
                    aria-label="Send"
                    onClick={() => {
                      void handleSubmit();
                    }}
                    disabled={!canSubmit}
                    color="primary"
                    size="small"
                    data-testid="chat-session-pending-submit"
                    sx={{
                      backgroundColor: "primary.main",
                      color: "primary.contrastText",
                      "&:hover": {
                        backgroundColor: "primary.dark",
                      },
                      "&.Mui-disabled": {
                        backgroundColor: "action.disabledBackground",
                        color: "action.disabled",
                      },
                    }}
                  >
                    <SendOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
        </MentionEditorContext.Provider>
      )}
    </Box>
  );
};
