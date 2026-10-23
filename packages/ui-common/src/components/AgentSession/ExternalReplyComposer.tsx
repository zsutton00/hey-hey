import { AttachmentDropZone } from "./AttachmentDropZone";
import { AttachmentChips } from "./AttachmentChips";
import { useRunAttachments } from "./runtime/hooks/useRunAttachments";
import { type RunAttachmentTarget } from "./runtime/hooks/runAttachmentDrop";
import type { SubagentComposerCapability } from "./subagentComposerState";
import type { ExternalReplyAvailability } from "./replyComposerPolicy";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  SvgIcon,
  Typography,
  Tooltip,
  useTheme,
} from "@mui/material";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RunAttachmentReference, AgentSkillSelection } from "../../api";
import { useLocalDraftRecovery } from "../../hooks/useLocalDraftRecovery";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";
import { SmarterTextAreaEditor } from "../SmarterTextAreaCard/SmarterTextAreaEditor";
import { useNavigate } from "react-router-dom";
import type { FileReferenceScope } from "../../data/hooks/useFileReferenceCandidates";
import {
  AgentSessionMetadata,
  type AgentSessionMetadataValues,
} from "./AgentSessionMetadata";
import { NewConversationConfirmationDialog } from "../Conversation/NewConversationConfirmationDialog";
import { SubmitButton } from "../SubmitButton";
import {
  getFailureIdentityKey,
  type UnavailableOutcome,
} from "./codingSessionFeedback";
import type {
  AgentComposerContext,
  AttachedAgentComposerContext,
  PreRunAgentComposerContext,
} from "../SmarterTextAreaCard/slashCommands/types";
import {
  startsWithSubagentCommand,
  type SubagentCommandIntent,
} from "../SmarterTextAreaCard/slashCommands/subagentCommand";
import type { SubagentEditorState } from "../SmarterTextAreaCard/slashCommands/subagentEditorState";
import {
  SubagentServicesContext,
  type SubagentServiceScope,
} from "../SmarterTextAreaCard/slashCommands/SubagentServicesContext";
import {
  resolveMessageAgentCommand,
  type MessageAgentCommandIntent,
} from "../SmarterTextAreaCard/slashCommands/messageAgentCommand";

interface ExternalReplyComposerProps {
  attachmentTarget: RunAttachmentTarget | null;
  messageContext: {
    organizationId: string;
    projectId: string;
    conversationId: string;
  } | null;
  submittingPrompt: boolean;
  onSubmitReply: (
    text: string,
    skillSelection?: AgentSkillSelection,
    attachments?: RunAttachmentReference[],
  ) => Promise<void>;
  onSubmitMessageAgent?: (
    intent: MessageAgentCommandIntent,
    interactionId: string,
  ) => Promise<void>;
  subagentCapability: SubagentComposerCapability;
  /** Provider and host identity required to browse installed Skills. */
  attachedAgent?:
    | Omit<AttachedAgentComposerContext, "selectedSkill" | "onSkillSelected">
    | Omit<PreRunAgentComposerContext, "selectedSkill" | "onSkillSelected">;
  /** When provided, renders a "New conversation" button */
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  /** Draft to seed when this composer belongs to a newly selected session. */
  initialDraft?: string;
  onDraftChange?: (draft: string) => void;
  /** Whether starting a new conversation requires an explicit confirmation. */
  confirmBeforeNewConversation?: boolean;
  /** Called when the user clicks the stop button */
  onStopRun?: () => void;
  /** Whether a stop request is currently in flight */
  stoppingRun?: boolean;
  /** Whether the run is actively processing — when false, stop is disabled */
  runProcessing?: boolean;
  /** Incremented by adjacent review actions to focus the shared composer. */
  focusSignal?: number;
  /** Task or feature context for historical touched-file suggestions. */
  fileReferenceScope?: FileReferenceScope;
  /** Durable provider/model plus optional effort metadata. */
  agentSessionMetadata?: AgentSessionMetadataValues;
  /** Editable model selection applied only when creating a new conversation. */
  newConversationModelSelector?: ReactNode;
  /** Replaces only the message editor while preserving stop and session actions. */
  editorReplacement?: ReactNode;
  availability: ExternalReplyAvailability;
}

const NewConversationIcon: React.FC<React.ComponentProps<typeof SvgIcon>> = (
  props,
) => (
  <SvgIcon {...props} viewBox="0 0 15 15">
    <path
      fill="currentColor"
      d="m5.5 11.493.416-.278a.5.5 0 0 0-.416-.222zm2 2.998-.416.277a.5.5 0 0 0 .832 0zm2-2.998v-.5a.5.5 0 0 0-.416.222zm-4.416.277 2 2.998.832-.555-2-2.998zm2.832 2.998 2-2.998-.832-.555-2 2.998zM9.5 11.993h4v-1h-4zm4 0c.829 0 1.5-.67 1.5-1.5h-1c0 .277-.223.5-.5.5zm1.5-1.5V1.5h-1v8.994zM15 1.5c0-.83-.671-1.5-1.5-1.5v1c.277 0 .5.223.5.5zM13.5 0h-12v1h12zm-12 0C.671 0 0 .67 0 1.5h1c0-.277.223-.5.5-.5zM0 1.5v8.994h1V1.499zm0 8.994c0 .829.671 1.499 1.5 1.499v-1a.5.5 0 0 1-.5-.5zm1.5 1.499h4v-1h-4zM7 4v5h1V4zM5 7h5V6H5z"
    />
  </SvgIcon>
);

const NO_SUBAGENT_SERVICES: SubagentServiceScope = {
  options: [],
  sourceServiceIds: [],
};
const STORAGE_KEY_PREFIX = "hey-hey:external-reply-draft:";
const START_NEW_CONVERSATION_MODEL_TOOLTIP =
  "Start a new conversation to the change the model";

interface ComposerPostFailure {
  readonly scopeKey: string;
  readonly attachments: RunAttachmentReference[];
  readonly subagentIntent: SubagentCommandIntent | null;
  readonly draft: string;
  readonly conversationId: string;
  readonly submissionIdentity: string;
  readonly reason: string;
  readonly skillSelection: AgentSkillSelection | null;
  readonly failureIdentity: { readonly reason: string };
  readonly isRetrying: boolean;
}

export const ExternalReplyComposer = ({
  messageContext,
  attachmentTarget,
  submittingPrompt,
  onSubmitReply,
  subagentCapability,
  onSubmitMessageAgent,
  onCreateNewConversation,
  initialDraft = "",
  onDraftChange,
  confirmBeforeNewConversation = false,
  onStopRun,
  stoppingRun = false,
  runProcessing = false,
  focusSignal,
  fileReferenceScope,
  agentSessionMetadata,
  newConversationModelSelector,
  editorReplacement,
  attachedAgent,
  availability,
}: ExternalReplyComposerProps) => {
  const disabled = !availability.available;
  const theme = useTheme();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initialDraft);
  const [subagentState, setSubagentState] = useState<SubagentEditorState>({
    kind: "literal",
  });
  const subagentStateRef = useRef(subagentState);
  const handleEditorChange = useCallback(
    (value: string, state: SubagentEditorState) => {
      setDraft(value);
      subagentStateRef.current = state;
      setSubagentState(state);
    },
    [],
  );
  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false);
  const [postFailure, setPostFailure] = useState<ComposerPostFailure | null>(
    null,
  );
  const [selectedSkill, setSelectedSkill] =
    useState<AgentSkillSelection | null>(null);
  const [clearSignal, setClearSignal] = useState(0);
  const [
    isNewConversationConfirmationOpen,
    setIsNewConversationConfirmationOpen,
  ] = useState(false);
  const [pendingNewConversationDraft, setPendingNewConversationDraft] =
    useState<string | null>(null);
  const [isCreatingNewConversation, setIsCreatingNewConversation] =
    useState(false);
  const editorKeyRef = useRef(0);
  const failureGenerationRef = useRef(0);
  const activeConversationId = messageContext?.conversationId ?? null;
  const runAttachments = useRunAttachments(
    attachmentTarget,
    activeConversationId,
    !disabled &&
      !submittingPrompt &&
      !editorReplacement &&
      messageContext !== null,
  );
  const submissionScopeKey = JSON.stringify([
    activeConversationId,
    attachmentTarget?.runId,
    attachmentTarget?.machineId,
  ]);
  const activeSubmissionScopeRef = useRef(submissionScopeKey);
  activeSubmissionScopeRef.current = submissionScopeKey;
  const draftConversationIdRef = useRef(activeConversationId);
  useEffect(() => {
    if (draftConversationIdRef.current === activeConversationId) return;
    draftConversationIdRef.current = activeConversationId;
    setDraft(initialDraft);
    subagentStateRef.current = { kind: "literal" };
    setSubagentState({ kind: "literal" });
    setPostFailure(null);
    editorKeyRef.current += 1;
  }, [activeConversationId, initialDraft]);

  const catalogAuthorityKey = attachedAgent
    ? JSON.stringify([
        attachedAgent.organizationId,
        attachedAgent.projectId,
        attachedAgent.machineId,
        attachedAgent.provider,
        "runId" in attachedAgent
          ? attachedAgent.runId
          : attachedAgent.catalogContext,
      ])
    : null;
  useEffect(() => {
    setSelectedSkill(null);
  }, [activeConversationId, catalogAuthorityKey]);

  const activePostFailure =
    postFailure?.scopeKey === submissionScopeKey ? postFailure : null;

  const storageKey = messageContext
    ? `${STORAGE_KEY_PREFIX}${messageContext.conversationId}`
    : `${STORAGE_KEY_PREFIX}__none__`;

  const composerAgentContext = useMemo<AgentComposerContext | null>(
    () =>
      attachedAgent
        ? {
            ...attachedAgent,
            selectedSkill,
            onSkillSelected: setSelectedSkill,
          }
        : null,
    [attachedAgent, selectedSkill],
  );

  const handleRestore = useCallback((restored: string) => {
    setDraft(restored);
    editorKeyRef.current += 1;
  }, []);

  useLocalDraftRecovery({
    storageKey,
    value: draft,
    isDirty: draft.trim().length > 0,
    isSaving: posting,
    onRestore: handleRestore,
    clearSignal,
  });

  const isDisabled =
    disabled || posting || submittingPrompt || messageContext === null;
  const canSubmit =
    !disabled &&
    draft.trim().length > 0 &&
    subagentState.kind !== "empty" &&
    !(
      subagentCapability.kind === "ready" &&
      startsWithSubagentCommand(draft) &&
      subagentState.kind !== "ready"
    ) &&
    messageContext !== null &&
    !posting &&
    !submittingPrompt;

  const submitDraft = useCallback(
    async (
      submittedDraft: string,
      submissionIdentity: string,
      isRetry: boolean,
      submittedSkillSelection: AgentSkillSelection | null,
      subagentIntent: SubagentCommandIntent | null,
      submittedAttachments: RunAttachmentReference[],
    ): Promise<void> => {
      const trimmedReply = submittedDraft.trim();
      if (
        trimmedReply.length === 0 ||
        postingRef.current ||
        submittingPrompt ||
        disabled ||
        !messageContext
      ) {
        return;
      }
      const submissionConversationId = messageContext.conversationId;
      const submittedScopeKey = submissionScopeKey;

      if (isRetry) {
        setPostFailure((current) =>
          current?.conversationId === submissionConversationId &&
          current.submissionIdentity === submissionIdentity
            ? { ...current, isRetrying: true }
            : current,
        );
      } else {
        setPostFailure(null);
      }
      postingRef.current = true;
      setPosting(true);
      try {
        const messageAgent = resolveMessageAgentCommand(submittedDraft);
        if (messageAgent.kind === "incomplete") {
          throw new Error(messageAgent.reason);
        }
        if (
          submittedAttachments.length > 0 &&
          (messageAgent.kind === "executable" ||
            subagentIntent ||
            startsWithSubagentCommand(submittedDraft))
        ) {
          throw new Error(
            "File attachments are supported on ordinary replies. Remove the files before sending a command.",
          );
        }
        if (messageAgent.kind === "executable") {
          if (!onSubmitMessageAgent)
            throw new Error(
              "Message-agent commands require an attached Agent Session.",
            );
          await onSubmitMessageAgent(messageAgent.intent, submissionIdentity);
        } else if (
          subagentIntent ||
          startsWithSubagentCommand(submittedDraft)
        ) {
          if (subagentCapability.kind === "unavailable") {
            throw new Error(subagentCapability.reason);
          }
          if (!subagentIntent) throw new Error("What should the subagent do?");
          await subagentCapability.submit(subagentIntent, submissionIdentity);
        } else {
          await onSubmitReply(
            submittedDraft,
            submittedSkillSelection ?? undefined,
            submittedAttachments,
          );
        }
        if (activeSubmissionScopeRef.current === submittedScopeKey) {
          runAttachments.clearSubmitted(submittedAttachments);
          setDraft("");
          editorKeyRef.current += 1;
          setClearSignal((prev) => prev + 1);
          setSelectedSkill(null);
          setPostFailure((current) =>
            current?.conversationId === submissionConversationId &&
            current.submissionIdentity === submissionIdentity
              ? null
              : current,
          );
        }
      } catch (err) {
        if (activeSubmissionScopeRef.current !== submittedScopeKey) {
          return;
        }
        setDraft(submittedDraft);
        setSelectedSkill(submittedSkillSelection);
        editorKeyRef.current += 1;
        const reason =
          err instanceof Error ? err.message : "Failed to send message.";
        const failureGeneration = ++failureGenerationRef.current;
        setPostFailure({
          scopeKey: submittedScopeKey,
          attachments: submittedAttachments,
          subagentIntent,
          draft: submittedDraft,
          conversationId: submissionConversationId,
          submissionIdentity,
          reason,
          skillSelection: submittedSkillSelection,
          failureIdentity: {
            reason: `${submissionIdentity}:${String(failureGeneration)}`,
          },
          isRetrying: false,
        });
      } finally {
        postingRef.current = false;
        setPosting(false);
      }
    },
    [
      disabled,
      messageContext,
      submissionScopeKey,
      onSubmitReply,
      runAttachments.clearSubmitted,
      subagentCapability,
      onSubmitMessageAgent,
      posting,
      submittingPrompt,
    ],
  );

  const submitReply = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    const submissionIdentity = crypto.randomUUID();
    const current = subagentStateRef.current;
    await submitDraft(
      draft,
      submissionIdentity,
      false,
      selectedSkill,
      current.kind === "ready" ? current.intent : null,
      runAttachments.references,
    );
  }, [canSubmit, draft, selectedSkill, submitDraft, runAttachments.references]);

  const retryPost = useCallback(() => {
    if (!activePostFailure) return;
    void submitDraft(
      activePostFailure.draft,
      activePostFailure.submissionIdentity,
      true,
      activePostFailure.skillSelection,
      activePostFailure.subagentIntent,
      activePostFailure.attachments,
    );
  }, [activePostFailure, submitDraft]);

  const composerFeedback: Extract<
    UnavailableOutcome,
    { presentationScope: "composer" }
  > | null = activePostFailure
    ? {
        status: "unavailable",
        presentationScope: "composer",
        reason: activePostFailure.reason,
        errorCode: null,
        retryable: true,
        failureIdentity: activePostFailure.failureIdentity,
        retry: retryPost,
        isRetrying: activePostFailure.isRetrying,
      }
    : null;

  const startNewConversation = useCallback(
    async (draftText: string) => {
      if (!onCreateNewConversation) return;

      setIsCreatingNewConversation(true);
      try {
        await onCreateNewConversation(draftText);
      } finally {
        setIsCreatingNewConversation(false);
      }
    },
    [onCreateNewConversation],
  );

  const handleRequestNewConversation = useCallback(() => {
    if (!confirmBeforeNewConversation) {
      void startNewConversation(draft);
      return;
    }

    setPendingNewConversationDraft(draft);
    setIsNewConversationConfirmationOpen(true);
  }, [confirmBeforeNewConversation, draft, startNewConversation]);

  const handleCloseNewConversationConfirmation = useCallback(() => {
    if (isCreatingNewConversation) return;
    setIsNewConversationConfirmationOpen(false);
    setPendingNewConversationDraft(null);
  }, [isCreatingNewConversation]);

  const handleConfirmNewConversation = useCallback(async () => {
    if (pendingNewConversationDraft === null || !onCreateNewConversation) {
      return;
    }

    await startNewConversation(pendingNewConversationDraft);
    setIsNewConversationConfirmationOpen(false);
    setPendingNewConversationDraft(null);
  }, [
    onCreateNewConversation,
    pendingNewConversationDraft,
    startNewConversation,
  ]);

  const contextValue = messageContext
    ? {
        projectId: messageContext.projectId,
        organizationId: messageContext.organizationId,
        navigate,
      }
    : null;

  return (
    <MentionEditorContext.Provider value={contextValue}>
      <AttachmentDropZone
        attachments={runAttachments}
        scopeKey={submissionScopeKey}
        testId="run-stream-external-reply-composer"
      >
        {runAttachments.rejection ? (
          <Alert severity="error" data-testid="run-attachment-rejection">
            {runAttachments.rejection}
          </Alert>
        ) : null}
        <AttachmentChips attachments={runAttachments} />
        {composerAgentContext && selectedSkill ? (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            data-testid="agent-skill-selection-summary"
            sx={{
              px: 1.25,
              py: 0.75,
              borderRadius: 1,
              backgroundColor: "action.hover",
              width: "fit-content",
              maxWidth: "100%",
            }}
          >
            <Typography variant="body2" sx={{ minWidth: 0 }}>
              Skill: {selectedSkill.name} · {selectedSkill.provider} ·{" "}
              {selectedSkill.catalogScope}
            </Typography>
            <IconButton
              size="small"
              aria-label="Clear selected Skill"
              data-testid="clear-agent-skill-selection"
              onClick={() => setSelectedSkill(null)}
              disabled={posting}
            >
              <span aria-hidden="true">×</span>
            </IconButton>
          </Stack>
        ) : null}
        {editorReplacement ?? (
          <SubagentServicesContext.Provider
            value={
              subagentCapability.kind === "ready"
                ? subagentCapability.services
                : NO_SUBAGENT_SERVICES
            }
          >
            <SmarterTextAreaEditor
              key={activeConversationId}
              context={messageContext}
              initialValue={draft}
              onChange={handleEditorChange}
              fileReferenceScope={fileReferenceScope}
              agentContext={composerAgentContext}
              subagentCommandAvailable={subagentCapability.kind === "ready"}
              messageAgentCommandAvailable={Boolean(onSubmitMessageAgent)}
              editable={!isDisabled}
              submitDisabled={!canSubmit}
              onSubmit={() => {
                void submitReply();
              }}
              reset={{ key: editorKeyRef.current, value: draft }}
              presentation={{
                focusSignal,
                containerSx: {
                  position: "relative",
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  "&:focus-within": {
                    borderColor: theme.palette.primary.main,
                    boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
                  },
                },
                contentEditableTestId: "run-stream-external-reply-input",
                contentEditableStyle: {
                  outline: "none",
                  padding: "16.5px 14px",
                  minHeight: "84px",
                  fontSize: "1rem",
                  lineHeight: 1.5,
                  fontFamily: "inherit",
                },
                placeholder:
                  subagentState.kind === "ready" ||
                  subagentState.kind === "empty"
                    ? "What should the subagent do?"
                    : "Send a follow-up message to the active agent session.",
                placeholderStyle: {
                  top: "16.5px",
                  left: "14px",
                  color: theme.palette.text.secondary,
                  fontSize: "1rem",
                  lineHeight: 1.5,
                  fontFamily: "inherit",
                },
              }}
            />
          </SubagentServicesContext.Provider>
        )}
        {composerFeedback ? (
          <Alert
            severity="error"
            data-testid="run-stream-external-reply-error"
            data-failure-identity={getFailureIdentityKey(
              composerFeedback.failureIdentity,
            )}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={composerFeedback.retry}
                disabled={
                  disabled || submittingPrompt || composerFeedback.isRetrying
                }
                data-testid="run-stream-external-reply-retry"
              >
                {composerFeedback.isRetrying ? "Retrying…" : "Retry"}
              </Button>
            }
          >
            {composerFeedback.reason}
          </Alert>
        ) : null}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "nowrap",
            width: "100%",
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexShrink: 0,
            }}
          >
            {editorReplacement ? null : (
              <Tooltip title="Send (⌘+Enter)">
                <span>
                  <SubmitButton
                    onClick={() => {
                      void submitReply();
                    }}
                    disabled={!canSubmit}
                  />
                </span>
              </Tooltip>
            )}
            {onStopRun ? (
              <Tooltip title="Stop agent">
                <span>
                  <IconButton
                    aria-label="Stop"
                    onClick={onStopRun}
                    disabled={stoppingRun || !runProcessing}
                    size="small"
                    data-testid="run-stream-stop"
                    sx={{
                      minWidth: 40,
                      minHeight: 40,
                      backgroundColor: "error.main",
                      color: "error.contrastText",
                      "&:hover": {
                        backgroundColor: "error.dark",
                      },
                      "&.Mui-disabled": {
                        backgroundColor: "action.disabledBackground",
                        color: "action.disabled",
                      },
                    }}
                  >
                    <StopCircleOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </Box>
          {agentSessionMetadata ? (
            onCreateNewConversation ? (
              <Tooltip title={START_NEW_CONVERSATION_MODEL_TOOLTIP} arrow>
                <Box
                  data-testid="run-stream-model-change-tooltip-target"
                  sx={{ flex: "1 1 auto", minWidth: 0, maxWidth: "100%" }}
                >
                  <AgentSessionMetadata
                    placement="below-composer"
                    {...agentSessionMetadata}
                  />
                </Box>
              </Tooltip>
            ) : (
              <AgentSessionMetadata
                placement="below-composer"
                {...agentSessionMetadata}
              />
            )
          ) : null}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              flexShrink: 0,
              marginLeft: "auto",
            }}
          >
            {onCreateNewConversation && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<NewConversationIcon />}
                onClick={handleRequestNewConversation}
                disabled={isCreatingNewConversation}
                data-testid="run-stream-new-conversation"
              >
                New conversation
              </Button>
            )}
          </Box>
        </Box>
      </AttachmentDropZone>
      <NewConversationConfirmationDialog
        open={isNewConversationConfirmationOpen}
        onClose={handleCloseNewConversationConfirmation}
        onConfirm={() => {
          void handleConfirmNewConversation().catch(() => undefined);
        }}
        isConfirming={isCreatingNewConversation}
        setupContent={newConversationModelSelector}
      />
    </MentionEditorContext.Provider>
  );
};
