import {
  Alert,
  AlertTitle,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCreateEntityPromptTemplateRetirementProposal } from "@hey-hey/ui-common/data";
import type {
  EntityPromptTemplateCatalogEntryDto,
  EntityPromptTemplateSelectorDto,
  ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import React, { useRef, useState } from "react";

export interface EntityPromptTemplatePublicationActionsProps {
  disabled?: boolean;
  organizationId: string;
  projectId: string;
  template: EntityPromptTemplateCatalogEntryDto;
  selector: EntityPromptTemplateSelectorDto;
  onProposalCreated?: (proposal: ProposalResponseDto) => void;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : "The retirement proposal could not be created. Please try again.";

export const EntityPromptTemplatePublicationActions: React.FC<
  EntityPromptTemplatePublicationActionsProps
> = ({
  disabled = false,
  organizationId,
  projectId,
  template,
  selector,
  onProposalCreated,
}) => {
  const activeProjectOverride = template.projectOverride;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [eli5, setEli5] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const createRetirementProposal =
    useCreateEntityPromptTemplateRetirementProposal();
  const isPending =
    disabled || isSubmitting || createRetirementProposal.isPending;

  if (!activeProjectOverride) {
    return null;
  }

  const finishSubmission = (): void => {
    submissionLock.current = false;
    setIsSubmitting(false);
  };

  const handleRetirementProposal = (): void => {
    if (submissionLock.current || isPending) {
      return;
    }

    submissionLock.current = true;
    setIsSubmitting(true);
    setDialogOpen(false);
    setSuccessMessage(null);
    setError(null);

    try {
      const request = createRetirementProposal.mutate({
        organizationId,
        projectId,
        eli5,
        templateKey: template.templateKey,
        selector,
        expectedEffectiveRevision: {
          revisionId: template.effective.revisionId,
          revisionNumber: template.effective.revisionNumber,
        },
      });
      void request
        .then((proposal) => {
          onProposalCreated?.(proposal);
          setSuccessMessage(
            "Retirement proposal created. The project override remains effective until approval."
          );
        })
        .catch((caughtError: unknown) => {
          setError(getErrorMessage(caughtError));
        })
        .finally(finishSubmission);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      finishSubmission();
    }
  };

  return (
    <Stack
      spacing={1.5}
      data-testid="entity-prompt-template-retirement-actions"
    >
      <Typography component="h3" variant="subtitle1">
        Project override retirement
      </Typography>
      <Button
        variant="outlined"
        color="warning"
        onClick={() => setDialogOpen(true)}
        disabled={isPending}
        data-testid="entity-prompt-template-propose-retirement"
        aria-label={`Propose retirement of revision ${activeProjectOverride.revisionNumber}`}
      >
        {isPending ? (
          <>
            <CircularProgress size={18} sx={{ mr: 1 }} />
            Creating proposal…
          </>
        ) : (
          `Propose retirement of revision ${activeProjectOverride.revisionNumber}`
        )}
      </Button>

      {successMessage && (
        <Alert
          severity="success"
          data-testid="entity-prompt-template-retirement-success"
        >
          {successMessage}
        </Alert>
      )}
      {error && (
        <Alert
          severity="error"
          data-testid="entity-prompt-template-retirement-error"
        >
          <AlertTitle>Unable to create retirement proposal</AlertTitle>
          {error}
        </Alert>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        aria-labelledby="entity-prompt-template-retire-dialog-title"
        aria-describedby="entity-prompt-template-retire-dialog-description"
      >
        <DialogTitle id="entity-prompt-template-retire-dialog-title">
          Propose project override retirement?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="entity-prompt-template-retire-dialog-description">
            Approval will retire revision {activeProjectOverride.revisionNumber}
            and make the canonical default effective. Until then, this project
            override remains authoritative.
          </DialogContentText>
          <TextField
            fullWidth
            margin="normal"
            label="Explain this change in one sentence"
            value={eli5}
            onChange={(event) => setEli5(event.target.value)}
            inputProps={{ maxLength: 150 }}
            disabled={isPending}
            data-testid="entity-prompt-template-retire-eli5"
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDialogOpen(false)}
            data-testid="entity-prompt-template-retire-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleRetirementProposal}
            color="warning"
            variant="contained"
            disabled={isPending || !eli5.trim()}
            data-testid="entity-prompt-template-retire-confirm"
          >
            Create retirement proposal
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

EntityPromptTemplatePublicationActions.displayName =
  "EntityPromptTemplatePublicationActions";
