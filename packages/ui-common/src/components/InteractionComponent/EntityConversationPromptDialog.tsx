import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import type {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  MachineDto,
} from "../../api";
import { MachinePicker } from "../AgentSession/MachinePicker";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import type { ReasoningEffort } from "../AgentSession/runtime/types";
import type { RuntimeModelCatalogSource } from "../AgentSession/useRuntimeModelCatalog";
import { buildEntityConversationPrompt } from "./entityConversationPrompt";

export interface EntityConversationPromptRuntimeSelection {
  machines: MachineDto[];
  selectedMachineId: string | null;
  onMachineChange: (machineId: string) => void;
  /** The machine whose CLI offers the model choices; null until one is picked. */
  catalogSource: RuntimeModelCatalogSource | null;
  /** Null until the picked machine's CLI has reported its catalog. */
  provider: ConversationStartRunRequestDtoProviderEnum | null;
  model: string | null;
  reasoningEffort:
    ConversationStartRunRequestDtoReasoningEffortEnum | ReasoningEffort | null;
  fastMode: boolean;
  onProviderChange: (
    provider: ConversationStartRunRequestDtoProviderEnum,
  ) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (reasoningEffort: ReasoningEffort | null) => void;
  onFastModeChange: (fastMode: boolean) => void;
}

export interface EntityConversationPromptDialogError {
  message: string;
  testId: string;
}

interface EntityConversationPromptDialogActionBase {
  label: string;
  pendingLabel: string;
  pending: boolean;
  testId: string;
  error?: EntityConversationPromptDialogError | null;
}

export type EntityConversationPromptDialogPrimaryAction =
  EntityConversationPromptDialogActionBase;

export interface EntityConversationPromptDialogSecondaryAction extends EntityConversationPromptDialogActionBase {
  onClick: () => void;
}

export interface EntityConversationPromptDialogProps {
  open: boolean;
  title: ReactNode;
  question: ReactNode;
  preCannedPrompt: string;
  userInput: string;
  onUserInputChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
  primaryAction: EntityConversationPromptDialogPrimaryAction;
  secondaryAction?: EntityConversationPromptDialogSecondaryAction;
  runtimeSelection?: EntityConversationPromptRuntimeSelection;
  inputLabel?: string;
  testIdPrefix?: string;
  dialogTestId?: string;
  questionTestId?: string;
  inputTestId?: string;
  runtimeTestId?: string;
  noMachineWarning?: ReactNode;
}

const DEFAULT_TEST_ID_PREFIX = "entity-conversation-prompt";

export const EntityConversationPromptDialog = ({
  open,
  title,
  question,
  preCannedPrompt,
  userInput,
  onUserInputChange,
  onClose,
  onSubmit,
  primaryAction,
  secondaryAction,
  runtimeSelection,
  inputLabel = "Additional instructions (optional)",
  testIdPrefix = DEFAULT_TEST_ID_PREFIX,
  dialogTestId = `${testIdPrefix}-dialog`,
  questionTestId = `${testIdPrefix}-question`,
  inputTestId = `${testIdPrefix}-user-input`,
  runtimeTestId = `${testIdPrefix}-runtime`,
  noMachineWarning = `No execution-ready CLI machine is available. ${primaryAction.label} will remain available and can be retried after a machine is connected.`,
}: EntityConversationPromptDialogProps) => {
  const pending = primaryAction.pending || (secondaryAction?.pending ?? false);
  const handleSubmit = () => {
    onSubmit(buildEntityConversationPrompt(preCannedPrompt, userInput));
  };

  return (
    <Dialog
      open={open}
      onClose={pending ? undefined : onClose}
      maxWidth="md"
      fullWidth
      data-testid={dialogTestId}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography data-testid={questionTestId}>{question}</Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            maxRows={8}
            label={inputLabel}
            value={userInput}
            onChange={(event) => onUserInputChange(event.target.value)}
            disabled={pending}
            inputProps={{ "data-testid": inputTestId }}
          />
          {runtimeSelection ? (
            <Stack spacing={2} data-testid={runtimeTestId}>
              <RuntimeModelSelector
                testIdPrefix={testIdPrefix}
                catalogSource={runtimeSelection.catalogSource}
                provider={runtimeSelection.provider}
                model={runtimeSelection.model}
                reasoningEffort={runtimeSelection.reasoningEffort}
                fastMode={runtimeSelection.fastMode}
                onProviderChange={runtimeSelection.onProviderChange}
                onModelChange={runtimeSelection.onModelChange}
                onReasoningEffortChange={
                  runtimeSelection.onReasoningEffortChange
                }
                onFastModeChange={runtimeSelection.onFastModeChange}
                disabled={pending}
              />
              {runtimeSelection.machines.length > 0 ? (
                <Box sx={{ minWidth: 220 }}>
                  <MachinePicker
                    machines={runtimeSelection.machines}
                    selectedMachineId={runtimeSelection.selectedMachineId}
                    onSelect={runtimeSelection.onMachineChange}
                    disabled={pending}
                    mobileMode="editor"
                  />
                </Box>
              ) : (
                <Alert severity="warning">{noMachineWarning}</Alert>
              )}
            </Stack>
          ) : null}
          {secondaryAction?.error ? (
            <Alert severity="error" data-testid={secondaryAction.error.testId}>
              {secondaryAction.error.message}
            </Alert>
          ) : null}
          {primaryAction.error ? (
            <Alert severity="error" data-testid={primaryAction.error.testId}>
              {primaryAction.error.message}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions data-testid="entity-conversation-prompt-actions">
        <Button
          onClick={onClose}
          disabled={pending}
          data-testid={`${testIdPrefix}-cancel`}
        >
          Cancel
        </Button>
        {secondaryAction ? (
          <Button
            variant="contained"
            onClick={secondaryAction.onClick}
            disabled={pending}
            data-testid={secondaryAction.testId}
            startIcon={
              secondaryAction.pending ? (
                <CircularProgress size={16} color="inherit" />
              ) : null
            }
          >
            {secondaryAction.pending
              ? secondaryAction.pendingLabel
              : secondaryAction.label}
          </Button>
        ) : null}
        <Button
          variant="contained"
          color="primary"
          onClick={handleSubmit}
          disabled={
            pending ||
            (runtimeSelection !== undefined &&
              (runtimeSelection.provider === null ||
                runtimeSelection.model === null))
          }
          data-testid={primaryAction.testId}
          startIcon={
            primaryAction.pending ? (
              <CircularProgress size={16} color="inherit" />
            ) : null
          }
        >
          {primaryAction.pending
            ? primaryAction.pendingLabel
            : primaryAction.label}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
