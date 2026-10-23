import { EntityType, type AgentSkillSelection } from "../../api";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import LanguageIcon from "@mui/icons-material/Language";
import type { SlashFocalEntityState } from "../SmarterTextAreaCard/slashCommands/types";
import { SmarterTextAreaEditor } from "../SmarterTextAreaCard/SmarterTextAreaEditor";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import { MachinePicker } from "../AgentSession/MachinePicker";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";
import { resolveAgentBridgeRecoveryState } from "../AgentSession/agentBridgeRecoveryState";
import { AgentBridgeRecoveryNotice } from "../AgentSession/AgentBridgeRecoveryNotice";
import {
  DISCUSS_SURFACE_ID,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../AgentSession/useSurfaceSelection";
import { ConversationStartRunRequestDtoProviderEnum } from "../../api";
import type { ReasoningEffort } from "../AgentSession/runtime/types";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import type { FileReferenceScope } from "../../data/hooks/useFileReferenceCandidates";
import { usePlatformAdminAccess } from "../../data/hooks/usePlatformAdminAccess";
import { AttachmentChips } from "../AgentSession/AttachmentChips";
import { AttachmentDropZone } from "../AgentSession/AttachmentDropZone";
import { useFileAttachments } from "../AgentSession/runtime/hooks/useFileAttachments";
import { useStagedBrowserTabOpener } from "../AgentSession/runtime/hooks/useStagedBrowserTabOpener";
import { SessionErrorAlert } from "../AgentSession/SessionErrorAlert";
import { NO_CLI_CONNECTION_CODE } from "../AgentSession/classifySessionError";
import type { EntityConversationLaunchError } from "./useEntityConversationLauncher";
import { ServiceSelector } from "../Selectors/ServiceSelector";
import type {
  EntityConversationProjectAssistantConfig,
  GraphConversationLaunchInput,
} from "./graphConversationLaunchInput";
import { useRole } from "../../hooks/auth/useRole";
import type { GuidableEntity } from "../GuidedWalkthrough/types";
import { useDiscussWalkthrough } from "./useDiscussWalkthrough";
import { EntityIcon } from "../Entity/EntityIcon";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";

export type DiscussModalSubmitInput = GraphConversationLaunchInput;

export interface FixedServiceScope {
  serviceId: string;
  serviceName: string;
}

const PROJECT_ASSISTANT_DISABLED = {
  enabled: false,
} as const satisfies EntityConversationProjectAssistantConfig;

export interface DiscussModalProps {
  open: boolean;
  onClose: () => void;
  /** Resolves true once the launcher confirms the conversation started. */
  onSubmit: (submission: DiscussModalSubmitInput) => Promise<boolean>;
  submitError: EntityConversationLaunchError | null;
  onClearSubmitError: () => void;
  isLoading?: boolean;
  entityTitle?: string;
  organizationId?: string;
  projectId?: string;
  /** Prefer the machine that owns the source run when the modal opens. */
  preferredMachineId?: string | null;
  fixedServiceScope?: FixedServiceScope;
  focalEntity: SlashFocalEntityState;
  /** Walkthrough identity of the discussed entity; null when not guidable. */
  walkthroughEntity: GuidableEntity | null;
  fileReferenceScope: FileReferenceScope | null;
  placeholder?: string;
  /**
   * Optional plain-text prompt to seed the editor with on first mount. Useful
   * for demo/onboarding flows that want the modal to appear pre-filled. The
   * value is inserted exactly once; subsequent updates do not replace user
   * edits.
   */
  initialValue?: string;
  /**
   * When true, renders the modal inline (no Portal to document.body) and
   * positions it absolutely so it stays within the nearest positioned
   * ancestor. Used by demo/onboarding scenes that embed the modal visual
   * inside a bounded container.
   */
  disablePortal?: boolean;
}

const DEFAULT_PLACEHOLDER =
  "Describe what you'd like the agent to help with...";
const NOOP_CLEAR_SUBMIT_ERROR = () => {};
type DiscussLaunchAction = "quickQuestion" | "startConversation";
const CLEARED_EDITOR = { key: 0, value: "" } as const;

const DiscussSubmitError: React.FC<{
  error: EntityConversationLaunchError | null;
}> = ({ error }) => {
  if (error === null) return null;

  return (
    <Box data-testid="discuss-modal-submit-error" sx={{ mt: 1 }}>
      {error.code === NO_CLI_CONNECTION_CODE ? (
        <SessionErrorAlert error={error.message} errorCode={error.code} />
      ) : (
        <Alert severity="error">
          <AlertTitle>Something went wrong</AlertTitle>
          {error.message}
        </Alert>
      )}
    </Box>
  );
};

export const DiscussModal: React.FC<DiscussModalProps> = ({
  open,
  onClose,
  onSubmit,
  submitError = null,
  onClearSubmitError = NOOP_CLEAR_SUBMIT_ERROR,
  isLoading = false,
  entityTitle,
  organizationId,
  projectId,
  preferredMachineId = null,
  fixedServiceScope,
  focalEntity,
  walkthroughEntity,
  fileReferenceScope,
  placeholder = DEFAULT_PLACEHOLDER,
  initialValue,
  disablePortal = false,
}) => {
  const theme = useTheme();
  const { isOrganizationAdmin } = useRole();
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const canConfigureCodexSystemPrompt = isOrganizationAdmin || isPlatformAdmin;
  const [selectedSkill, setSelectedSkill] =
    useState<AgentSkillSelection | null>(null);
  const [prompt, setPrompt] = useState(initialValue ?? "");
  const [disableCodexSystemPrompt, setDisableCodexSystemPrompt] =
    useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editorReset, setEditorReset] = useState<{
    key: number;
    value: string;
  }>(CLEARED_EDITOR);
  const [pendingAction, setPendingAction] =
    useState<DiscussLaunchAction | null>(null);
  const wasLoading = useRef(isLoading);
  const focalWorkItemId =
    focalEntity.kind === "entity" && focalEntity.entityType === EntityType.Task
      ? focalEntity.entityId
      : undefined;
  const { workItem: focalWorkItem } = useWorkItem(
    organizationId ?? "",
    "task",
    focalWorkItemId ?? "",
    { projectId, enabled: open && !!organizationId && !!focalWorkItemId },
  );
  const workItemTypeKey = focalWorkItem?.type;
  const { workItemTypeSummary } = useWorkItemTypeByKey(
    organizationId,
    projectId,
    workItemTypeKey,
  );

  useEffect(() => {
    if (wasLoading.current && !isLoading) {
      setPendingAction(null);
    }
    wasLoading.current = isLoading;
  }, [isLoading]);

  const {
    machines,
    mode: machineMode,
    selectedMachine,
    setSelectedMachineId,
  } = useMachineResolution(preferredMachineId);
  const selectedMachineId = selectedMachine?.machineId ?? null;
  const [attachmentScope, setAttachmentScope] = useState(0);
  const attachments = useFileAttachments(
    selectedMachineId
      ? { kind: "pre-run", machineId: selectedMachineId }
      : null,
    String(attachmentScope),
    !isLoading,
  );
  const stagedBrowser = useStagedBrowserTabOpener(
    selectedMachineId,
    projectId ?? null,
    String(attachmentScope),
  );
  const recoveryState = useMemo(
    () =>
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: false,
        machines,
        selectedMachineId,
      }),
    [machines, selectedMachineId],
  );
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const catalogSource = useMemo(
    () =>
      organizationId && projectId && selectedMachineId
        ? { organizationId, projectId, machineId: selectedMachineId }
        : null,
    [organizationId, projectId, selectedMachineId],
  );
  const { selection, updateSelection: patchSelection } = useSurfaceSelection({
    surfaceId: DISCUSS_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });

  const updateSelection = useCallback(
    (patch: (prev: SurfaceSelection) => SurfaceSelection) => {
      patchSelection((prev) => {
        const next = patch(prev);
        writeSurfaceSelection(DISCUSS_SURFACE_ID, next);
        return next;
      });
    },
    [patchSelection],
  );

  const handleProviderChange = useCallback(
    (provider: ConversationStartRunRequestDtoProviderEnum) => {
      updateSelection((prev) => ({ ...prev, provider }));
    },
    [updateSelection],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      updateSelection((prev) => ({ ...prev, model }));
    },
    [updateSelection],
  );

  const handleReasoningEffortChange = useCallback(
    (reasoningEffort: ReasoningEffort | null) => {
      updateSelection((prev) => ({ ...prev, reasoningEffort }));
    },
    [updateSelection],
  );

  const handleFastModeChange = useCallback(
    (fastMode: boolean) => {
      updateSelection((prev) => ({ ...prev, fastMode }));
    },
    [updateSelection],
  );

  const fillPrompt = useCallback((text: string) => {
    setPrompt(text);
    setValidationError(null);
    setEditorReset((prev) => ({ key: prev.key + 1, value: text }));
  }, []);
  const walkthrough = useDiscussWalkthrough({
    open,
    entity: walkthroughEntity,
    prompt,
    fillPrompt,
  });
  const { reportStartConversationOutcome } = walkthrough;

  const handleSubmit = useCallback(
    async (
      projectAssistant?: EntityConversationProjectAssistantConfig,
      initiatingAction?: DiscussLaunchAction,
    ) => {
      const trimmed = prompt.trim();
      if (trimmed.length === 0) {
        setValidationError("Please enter a prompt to start the conversation.");
        return;
      }
      if (!selectedMachineId) {
        setValidationError(
          machines.length === 0
            ? "No CLI machine is paired. Connect or pair a CLI machine to start the conversation."
            : machineMode === "zero"
              ? "No paired CLI machine is ready for local execution. Review the machine state below."
              : "Please select a CLI machine to start the conversation.",
        );
        return;
      }
      if (!selection) {
        setValidationError(
          "Wait for the machine's model choices to load, then pick a model.",
        );
        return;
      }
      if (attachments.blocked) {
        setValidationError(
          "Wait for uploads to finish and remove failed files before submitting.",
        );
        return;
      }
      setValidationError(null);
      onClearSubmitError();
      setPendingAction(initiatingAction ?? null);
      const supportsFast = supportsFastMode(
        selection.provider,
        selection.model,
      );
      const effectiveServiceId =
        fixedServiceScope?.serviceId ?? selectedServiceId;
      const submittedAttachments = attachments.references;
      const submittedBrowserTab = stagedBrowser.stagedBrowserTab;
      const launched = await onSubmit({
        prompt: trimmed,
        attachments: submittedAttachments,
        stagedBrowserTab: submittedBrowserTab,
        ...(selectedSkill ? { skillSelection: selectedSkill } : {}),
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        machineId: selectedMachineId,
        ...(supportsFast ? { fastMode: selection.fastMode ?? false } : {}),
        ...(effectiveServiceId === null
          ? {}
          : { serviceId: effectiveServiceId }),
        ...(projectAssistant === undefined ? {} : { projectAssistant }),
        ...(canConfigureCodexSystemPrompt &&
        selection.provider === ConversationStartRunRequestDtoProviderEnum.Codex
          ? { disableCodexSystemPrompt }
          : {}),
      });
      if (launched) {
        attachments.clearSubmitted(submittedAttachments);
        stagedBrowser.clearSubmitted(submittedBrowserTab);
      }
      // Quick Question disables the Project Assistant bootstrap; only the
      // contextual Start Conversation launch completes the walkthrough.
      if (projectAssistant === undefined) {
        reportStartConversationOutcome(launched);
      }
    },
    [
      attachments,
      stagedBrowser,
      machineMode,
      reportStartConversationOutcome,
      selectedSkill,
      machines.length,
      canConfigureCodexSystemPrompt,
      disableCodexSystemPrompt,
      fixedServiceScope?.serviceId,
      onClearSubmitError,
      onSubmit,
      prompt,
      selectedMachineId,
      selection,
      selectedServiceId,
    ],
  );

  const handleClose = useCallback(() => {
    if (isLoading) return;
    setPrompt("");
    setValidationError(null);
    setEditorReset((prev) => ({ key: prev.key + 1, value: "" }));
    setAttachmentScope((prev) => prev + 1);
    setPendingAction(null);
    onClearSubmitError();
    onClose();
  }, [isLoading, onClearSubmitError, onClose]);

  const handleChange = useCallback(
    (value: string) => {
      setPrompt(value);
      if (validationError) setValidationError(null);
    },
    [validationError],
  );

  const skillServiceId = fixedServiceScope?.serviceId ?? selectedServiceId;
  useEffect(() => {
    setSelectedSkill(null);
  }, [
    organizationId,
    projectId,
    selectedMachineId,
    skillServiceId,
    selection?.provider,
  ]);

  const editorContext =
    organizationId && projectId
      ? { organizationId, projectId, conversationId: null }
      : null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      data-testid="discuss-modal"
      onKeyDown={(e) => e.stopPropagation()}
      disablePortal={disablePortal}
      sx={
        disablePortal
          ? {
              position: "absolute",
              "& .MuiBackdrop-root": { position: "absolute" },
            }
          : undefined
      }
    >
      <DialogTitle>
        Discuss
        {entityTitle && (
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
          >
            {focalEntity.kind === "entity" &&
            (!focalWorkItemId || workItemTypeKey) ? (
              <EntityIcon
                entityType={focalEntity.entityType}
                workItemIcon={
                  focalWorkItemId && workItemTypeKey
                    ? {
                        typeKey: workItemTypeKey,
                        definition: workItemTypeSummary?.definition,
                        effectiveSource: workItemTypeSummary?.effectiveSource,
                      }
                    : undefined
                }
                size={20}
                aria-hidden="true"
                data-testid="discuss-modal-entity-icon"
              />
            ) : null}
            <Typography variant="body2" color="text.secondary" noWrap>
              {entityTitle}
            </Typography>
          </Box>
        )}
      </DialogTitle>
      <DialogContent>
        <AttachmentDropZone
          testId="discuss-modal-attachment-drop-zone"
          scopeKey={selectedMachineId ?? ""}
          attachments={attachments}
        >
          {attachments.rejection ? (
            <Alert severity="error" data-testid="run-attachment-rejection">
              {attachments.rejection}
            </Alert>
          ) : null}
          <AttachmentChips attachments={attachments} />
          <Box ref={walkthrough.editorTargetRef}>
            <SmarterTextAreaEditor
              context={editorContext}
              initialValue={initialValue}
              onChange={handleChange}
              fileReferenceScope={fileReferenceScope}
              focalEntity={focalEntity}
              agentContext={
                organizationId &&
                projectId &&
                selectedMachineId &&
                selection?.provider === "codex"
                  ? {
                      organizationId,
                      projectId,
                      machineId: selectedMachineId,
                      provider: "codex",
                      catalogContext: skillServiceId
                        ? {
                            policy: "service_workspace",
                            serviceId: skillServiceId,
                          }
                        : { policy: "non_repository" },
                      selectedSkill,
                      onSkillSelected: setSelectedSkill,
                    }
                  : null
              }
              editable={!isLoading}
              submitDisabled={isLoading}
              onSubmit={() => void handleSubmit()}
              reset={editorReset}
              presentation={{
                containerSx: {
                  mt: 1,
                  position: "relative",
                  border: `1px solid ${
                    validationError
                      ? theme.palette.error.main
                      : theme.palette.divider
                  }`,
                  borderRadius: 1,
                  "&:focus-within": {
                    borderColor: validationError
                      ? theme.palette.error.main
                      : theme.palette.primary.main,
                    borderWidth: 2,
                    margin: "-1px",
                    marginTop: "7px",
                  },
                },
                containerTestId: "discuss-modal-prompt",
                autoFocus: true,
                contentEditableTestId: "discuss-modal-input",
                contentEditableStyle: {
                  outline: "none",
                  padding: "16px",
                  minHeight: "140px",
                  maxHeight: "336px",
                  overflowY: "auto",
                  fontSize: "1rem",
                  lineHeight: 1.5,
                },
                contentEditableAriaLabel: "What would you like to discuss?",
                contentEditableAriaPlaceholder: placeholder,
                placeholder,
                placeholderStyle: {
                  color: theme.palette.text.secondary,
                },
              }}
            />
          </Box>
        </AttachmentDropZone>
        <Box
          ref={walkthrough.guidanceContainerRef}
          data-testid="discuss-walkthrough-guidance"
        />
        <Typography
          variant="caption"
          color={validationError ? "error.main" : "text.secondary"}
          sx={{ mt: 0.5, display: "block", px: 1.5 }}
        >
          {validationError ?? "Press Cmd+Enter to submit."}
        </Typography>
        <DiscussSubmitError error={submitError} />
        {machines.length === 0 ? (
          <AgentBridgeRecoveryNotice
            state={recoveryState}
            presentation="inline"
            testId="discuss-machine-unavailable"
          />
        ) : null}
      </DialogContent>
      <DialogActions
        sx={{
          flexDirection: "column",
          alignItems: "stretch",
          gap: 1.5,
          "& > :not(style) ~ :not(style)": { ml: 0 },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box
            data-testid="discuss-model-selector-container"
            sx={{ width: "100%", flexBasis: "100%", flexShrink: 0 }}
          >
            <RuntimeModelSelector
              testIdPrefix="discuss"
              catalogSource={catalogSource}
              provider={selection?.provider ?? null}
              model={selection?.model ?? null}
              reasoningEffort={selection?.reasoningEffort ?? null}
              fastMode={selection?.fastMode ?? false}
              onProviderChange={handleProviderChange}
              onModelChange={handleModelChange}
              onReasoningEffortChange={handleReasoningEffortChange}
              onFastModeChange={handleFastModeChange}
              rowEnd={
                machines.length > 0 ? (
                  <MachinePicker
                    machines={machines}
                    selectedMachineId={selectedMachineId}
                    onSelect={setSelectedMachineId}
                    disabled={isLoading}
                    mobileMode="editor"
                  />
                ) : undefined
              }
            />
          </Box>
          {canConfigureCodexSystemPrompt &&
          selection?.provider ===
            ConversationStartRunRequestDtoProviderEnum.Codex ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={disableCodexSystemPrompt}
                  onChange={(event) =>
                    setDisableCodexSystemPrompt(event.target.checked)
                  }
                  disabled={isLoading}
                  inputProps={{
                    "aria-label": "Disable Codex system prompt",
                  }}
                  data-testid="discuss-disable-codex-system-prompt"
                />
              }
              label="Disable Codex system prompt"
              sx={{ width: "100%", flexBasis: "100%" }}
            />
          ) : null}
          {fixedServiceScope && organizationId && projectId ? (
            <Box
              sx={{ width: 220, maxWidth: "100%", flexShrink: 0 }}
              data-testid="discuss-fixed-service"
            >
              <ServiceSelector
                organizationId={organizationId}
                projectId={projectId}
                value={fixedServiceScope.serviceId}
                onChange={() => undefined}
                placeholder={fixedServiceScope.serviceName}
                disabled
              />
            </Box>
          ) : organizationId && projectId ? (
            <Box
              sx={{ width: 220, maxWidth: "100%", flexShrink: 0 }}
              data-testid="discuss-service-selector"
            >
              <ServiceSelector
                organizationId={organizationId}
                projectId={projectId}
                value={selectedServiceId}
                onChange={setSelectedServiceId}
                placeholder="None"
                disabled={isLoading}
              />
            </Box>
          ) : null}
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mt: 1,
          }}
        >
          <Box
            data-testid="discuss-launch-tools"
            sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
          >
            <Tooltip
              title={
                stagedBrowser.blockedReason ??
                (stagedBrowser.stagedBrowserTab
                  ? "Browser tab opened. The new session takes it over."
                  : "Open browser")
              }
            >
              <span>
                <IconButton
                  aria-label="Open browser"
                  data-testid="discuss-open-browser"
                  onClick={() => void stagedBrowser.open()}
                  disabled={
                    isLoading ||
                    stagedBrowser.opening ||
                    stagedBrowser.blockedReason !== null ||
                    stagedBrowser.localCli.status !== "local"
                  }
                  color={stagedBrowser.stagedBrowserTab ? "primary" : "default"}
                  sx={{
                    width: 40,
                    height: 40,
                    border: 1,
                    borderColor: "divider",
                  }}
                >
                  {stagedBrowser.opening ? (
                    <CircularProgress size={18} aria-label="Opening browser" />
                  ) : (
                    <LanguageIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            {stagedBrowser.failure ? (
              <Typography
                variant="caption"
                color="error.main"
                role="alert"
                data-testid="discuss-open-browser-error"
              >
                {stagedBrowser.failure.reason}
              </Typography>
            ) : null}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="outlined"
            onClick={() =>
              void handleSubmit(PROJECT_ASSISTANT_DISABLED, "quickQuestion")
            }
            disabled={
              isLoading ||
              prompt.trim().length === 0 ||
              !selectedMachineId ||
              !selection ||
              attachments.blocked
            }
            data-testid="discuss-modal-ask"
            aria-label={
              pendingAction === "quickQuestion" && isLoading
                ? "Quick Question, starting conversation"
                : "Quick Question"
            }
            aria-busy={pendingAction === "quickQuestion" && isLoading}
          >
            {pendingAction === "quickQuestion" && isLoading ? (
              <CircularProgress
                size={18}
                color="inherit"
                aria-label="Starting conversation"
              />
            ) : (
              "Quick Question"
            )}
          </Button>
          <Button
            variant="contained"
            ref={walkthrough.startTargetRef}
            onClick={() => void handleSubmit(undefined, "startConversation")}
            disabled={
              isLoading ||
              prompt.trim().length === 0 ||
              !selectedMachineId ||
              !selection ||
              attachments.blocked
            }
            data-testid="discuss-modal-submit"
            aria-label={
              pendingAction === "startConversation" && isLoading
                ? "Start Conversation, starting conversation"
                : "Start Conversation"
            }
            aria-busy={pendingAction === "startConversation" && isLoading}
          >
            {pendingAction === "startConversation" && isLoading ? (
              <CircularProgress
                size={18}
                color="inherit"
                aria-label="Starting conversation"
              />
            ) : (
              "Start Conversation"
            )}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
