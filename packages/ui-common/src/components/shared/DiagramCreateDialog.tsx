import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useMemo, useState } from "react";
import type {
  ProposalResponseDto,
  WorkItemChangeSetIdentity,
  WorkItemTypeDefinitionDto,
} from "../../api";
import { useSubmitWorkItemGraphProposal } from "../../data/hooks/useSubmitWorkItemGraphProposal";
import {
  diagramCreationDraft,
  diagramCreationProposalDraft,
} from "./diagramCreationDraft";

export interface DiagramCreateDialogProps {
  open: boolean;
  organizationId: string;
  projectId: string;
  definition: WorkItemTypeDefinitionDto;
  parent?: WorkItemChangeSetIdentity;
  onClose: () => void;
  onSubmitted: (proposal: ProposalResponseDto) => void;
}

export function DiagramCreateDialog({
  open,
  organizationId,
  projectId,
  definition,
  parent,
  onClose,
  onSubmitted,
}: DiagramCreateDialogProps) {
  const [name, setName] = useState("");
  const [eli5, setEli5] = useState("");
  const submission = useSubmitWorkItemGraphProposal();
  const graphCapability = definition.capabilities?.graph;
  const draft = useMemo(() => {
    if (!graphCapability || !name.trim()) return null;
    const creation = diagramCreationDraft({ name, parent, graphCapability });
    return {
      creation,
      proposal: diagramCreationProposalDraft(
        creation,
        graphCapability.layout.sectionKey,
      ),
    };
  }, [graphCapability, name, parent]);

  const submit = async () => {
    if (!draft || !graphCapability) return;
    const proposal = await submission.submit({
      organizationId,
      projectId,
      eli5,
      root: draft.creation.root,
      graphCapability,
      draft: draft.proposal,
    });
    onSubmitted(proposal);
  };

  return (
    <Dialog
      open={open}
      onClose={submission.isPending ? undefined : onClose}
      fullWidth
      maxWidth="md"
      data-testid="diagram-create-dialog"
    >
      <DialogTitle>Create Diagram</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="normal"
          label="Diagram name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={submission.isPending}
        />
        <TextField
          fullWidth
          margin="normal"
          label="Explain this change in one sentence"
          value={eli5}
          onChange={(event) => setEli5(event.target.value)}
          inputProps={{ maxLength: 150 }}
          disabled={submission.isPending}
          data-testid="diagram-proposal-eli5"
        />
        <Alert severity="info">
          The Diagram, two initial elements, their relationship, metadata, and
          layout will be reviewed together.
        </Alert>
        {submission.error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {submission.error.message}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submission.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={!draft || !eli5.trim() || submission.isPending}
        >
          Review Diagram
        </Button>
      </DialogActions>
    </Dialog>
  );
}
