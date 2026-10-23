import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useCallback, useState } from "react";
import type {
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../api";
import { SmarterTextAreaCard } from "../SmarterTextAreaCard";
import { RuntimeModelSelector } from "./RuntimeModelSelector";
import { supportsFastMode } from "./capabilityCatalog";
import {
  writeSurfaceSelection,
  type SurfaceSelection,
} from "./surfaceSelectionMemory";
import type { RuntimeModelCatalogSource } from "./useRuntimeModelCatalog";
import { useSurfaceSelection } from "./useSurfaceSelection";

export interface FollowupActionSubmission {
  additionalInstructions: string | undefined;
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  fastMode?: boolean;
}

interface FollowupActionModalProps {
  open: boolean;
  surfaceId: string;
  /** The machine whose CLI offers the model choices; null until one is known. */
  catalogSource: RuntimeModelCatalogSource | null;
  onClose: () => void;
  onSubmit: (submission: FollowupActionSubmission) => void;
  submitting: boolean;
  title: string;
  submitLabel: string;
  submittingLabel: string;
  placeholder?: string;
}

export const FollowupActionModal = ({
  open,
  surfaceId,
  catalogSource,
  onClose,
  onSubmit,
  submitting,
  title,
  submitLabel,
  submittingLabel,
  placeholder = "Add any additional instructions... (optional)",
}: FollowupActionModalProps) => {
  const [instructions, setInstructions] = useState("");
  const { selection, updateSelection: patchSelection } = useSurfaceSelection({
    surfaceId,
    catalogSource,
    resetKey: open,
  });

  const updateSelection = useCallback(
    (patch: (prev: SurfaceSelection) => SurfaceSelection) => {
      patchSelection((current) => {
        const next = patch(current);
        writeSurfaceSelection(surfaceId, next);
        return next;
      });
    },
    [patchSelection, surfaceId],
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
    (
      reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null,
    ) => {
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

  const handleClose = () => {
    setInstructions("");
    onClose();
  };

  const handleSubmit = () => {
    const trimmed = instructions.trim();
    if (!selection) {
      return;
    }
    const currentSelection = selection;
    onSubmit({
      additionalInstructions: trimmed.length > 0 ? trimmed : undefined,
      provider: currentSelection.provider,
      model: currentSelection.model,
      reasoningEffort: currentSelection.reasoningEffort,
      ...(supportsFastMode(currentSelection.provider, currentSelection.model)
        ? { fastMode: currentSelection.fastMode ?? false }
        : {}),
    });
    setInstructions("");
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent data-testid={`${surfaceId}-followup-action-modal-content`}>
        <SmarterTextAreaCard
          value={instructions}
          onChange={setInstructions}
          placeholder={placeholder}
          saveStatus={submitting ? "submitting" : "draft"}
          saveMode={null}
          hasUnsavedChanges={instructions.trim().length > 0}
          isSaving={submitting}
          disabled={submitting}
          minInputHeight={120}
          headerSx={{ display: "none" }}
          onSubmit={handleSubmit}
        />
      </DialogContent>
      <DialogActions
        sx={{
          flexDirection: "column",
          alignItems: "stretch",
          gap: 1.5,
          "& > :not(style) ~ :not(style)": { ml: 0 },
        }}
      >
        <RuntimeModelSelector
          testIdPrefix={surfaceId}
          catalogSource={catalogSource}
          provider={selection?.provider ?? null}
          model={selection?.model ?? null}
          reasoningEffort={selection?.reasoningEffort ?? null}
          fastMode={selection?.fastMode ?? false}
          onProviderChange={handleProviderChange}
          onModelChange={handleModelChange}
          onReasoningEffortChange={handleReasoningEffortChange}
          onFastModeChange={handleFastModeChange}
          disabled={submitting}
        />
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 1,
          }}
        >
          <Button onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || !selection}
          >
            {submitting ? submittingLabel : submitLabel}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
