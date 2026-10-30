import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import { useEffect, useMemo, useState, type FC } from "react";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import {
  AgentEdgeDirection,
  AgentEdgeType,
  type AgentEdgeCategory,
  type ProjectedWorkItemRelationship,
  type WorkItemTypeGraphRelationshipDeclaration,
} from "../../api";

export interface WorkItemGraphRelationshipDialogValue {
  edgeType: AgentEdgeType;
  category: AgentEdgeCategory;
  direction?: AgentEdgeDirection;
  predicate?: string | null;
  actionLabel?: string | null;
  reasoning?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
}

export interface WorkItemGraphRelationshipDialogProps {
  open: boolean;
  declarations: readonly WorkItemTypeGraphRelationshipDeclaration[];
  relationship?: ProjectedWorkItemRelationship | null;
  actionLabelRequired?: boolean;
  onCancel: () => void;
  onCommit: (value: WorkItemGraphRelationshipDialogValue) => void;
}

function declarationFor(
  declarations: readonly WorkItemTypeGraphRelationshipDeclaration[],
  edgeType: string,
): WorkItemTypeGraphRelationshipDeclaration | undefined {
  return declarations.find((declaration) => declaration.edgeType === edgeType);
}

function initialDirection(
  declaration: WorkItemTypeGraphRelationshipDeclaration | undefined,
  relationship: ProjectedWorkItemRelationship | null | undefined,
): AgentEdgeDirection | "" {
  const allowed = declaration?.direction?.allowedDirections ?? [];
  if (relationship?.direction && allowed.includes(relationship.direction)) {
    return relationship.direction;
  }
  return allowed.length === 1 ? allowed[0] : "";
}

export const WorkItemGraphRelationshipDialog: FC<
  WorkItemGraphRelationshipDialogProps
> = ({
  open,
  declarations,
  relationship,
  actionLabelRequired = false,
  onCancel,
  onCommit,
}) => {
  const [edgeType, setEdgeType] = useState<AgentEdgeType | "">("");
  const [direction, setDirection] = useState<AgentEdgeDirection | "">("");
  const [predicate, setPredicate] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [editedLabel, setEditedLabel] = useState(false);
  const [editedActionLabel, setEditedActionLabel] = useState(false);
  const [editedDescription, setEditedDescription] = useState(false);
  const [editedReasoning, setEditedReasoning] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initialEdgeType =
      relationship?.edgeType ?? declarations[0]?.edgeType ?? "";
    const initialDeclaration = declarationFor(declarations, initialEdgeType);
    setEdgeType(initialEdgeType);
    setDirection(initialDirection(initialDeclaration, relationship));
    setPredicate(relationship?.predicate ?? "");
    setActionLabel(relationship?.actionLabel ?? "");
    setEditedActionLabel(false);
    setLabel(
      typeof relationship?.metadata?.label === "string"
        ? relationship.metadata.label
        : "",
    );
    setDescription(
      typeof relationship?.metadata?.description === "string"
        ? relationship.metadata.description
        : "",
    );
    setReasoning(relationship?.reasoning ?? "");
    setEditedLabel(false);
    setEditedDescription(false);
    setEditedReasoning(false);
  }, [declarations, open, relationship]);

  const selectedDeclaration = useMemo(
    () => declarationFor(declarations, edgeType),
    [declarations, edgeType],
  );
  const allowedDirections =
    selectedDeclaration?.direction?.allowedDirections ?? [];
  const directionRequired = selectedDeclaration?.direction?.required ?? false;
  const predicateRequired =
    selectedDeclaration?.direction?.predicateRequired ?? false;
  const actionLabelAllowed = selectedDeclaration?.category === "flow";
  const canCommit =
    Boolean(selectedDeclaration) &&
    (!directionRequired || direction !== "") &&
    (!predicateRequired || predicate.trim().length > 0) &&
    (!actionLabelRequired ||
      !actionLabelAllowed ||
      actionLabel.trim().length > 0);

  const commit = () => {
    if (!selectedDeclaration || !canCommit) return;
    const changedType = Boolean(
      relationship && relationship.edgeType !== selectedDeclaration.edgeType,
    );
    const committedPredicate = predicateRequired
      ? predicate.trim()
      : changedType
        ? null
        : undefined;
    const committedActionLabel = actionLabelAllowed
      ? actionLabel.trim() || (editedActionLabel ? null : undefined)
      : changedType && relationship?.actionLabel
        ? null
        : undefined;
    const editedMetadata = editedLabel || editedDescription;
    const metadata = editedMetadata
      ? {
          ...(relationship?.metadata ?? {}),
          ...(editedLabel ? { label: label.trim() || null } : {}),
          ...(editedDescription
            ? { description: description.trim() || null }
            : {}),
        }
      : changedType
        ? relationship?.metadata
        : undefined;
    const committedReasoning = editedReasoning
      ? reasoning.trim() || null
      : changedType
        ? relationship?.reasoning
        : undefined;
    onCommit({
      edgeType: selectedDeclaration.edgeType,
      category: selectedDeclaration.category,
      ...(direction ? { direction } : {}),
      ...(committedPredicate !== undefined
        ? { predicate: committedPredicate }
        : {}),
      ...(committedActionLabel !== undefined
        ? { actionLabel: committedActionLabel }
        : {}),
      ...(committedReasoning !== undefined
        ? { reasoning: committedReasoning }
        : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>
        {relationship ? "Edit relationship" : "Add relationship"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            required
            label="Relationship"
            value={edgeType}
            onChange={(event) => {
              const nextEdgeType = event.target.value as AgentEdgeType;
              const nextDeclaration = declarationFor(
                declarations,
                nextEdgeType,
              );
              setEdgeType(nextEdgeType);
              setDirection(initialDirection(nextDeclaration, null));
              setPredicate("");
              if (nextDeclaration?.category !== "flow") {
                setActionLabel("");
              }
            }}
            inputProps={{ "data-testid": "work-item-graph-relationship-type" }}
          >
            {declarations.map((declaration) => (
              <MenuItem key={declaration.edgeType} value={declaration.edgeType}>
                {declaration.edgeType}
              </MenuItem>
            ))}
          </TextField>
          {allowedDirections.length > 1 && (
            <TextField
              select
              required={directionRequired}
              label="Direction"
              value={direction}
              onChange={(event) =>
                setDirection(event.target.value as AgentEdgeDirection)
              }
              inputProps={{
                "data-testid": "work-item-graph-relationship-direction",
              }}
            >
              {allowedDirections.map((allowedDirection) => (
                <MenuItem key={allowedDirection} value={allowedDirection}>
                  {allowedDirection}
                </MenuItem>
              ))}
            </TextField>
          )}
          {predicateRequired && (
            <TextField
              required
              label="Predicate"
              value={predicate}
              error={!predicate.trim()}
              onChange={(event) => setPredicate(event.target.value)}
              inputProps={{
                "data-testid": "work-item-graph-relationship-predicate",
              }}
            />
          )}
          {actionLabelAllowed && (
            <TextField
              label={
                actionLabelRequired ? "Action label" : "Action label (optional)"
              }
              required={actionLabelRequired}
              value={actionLabel}
              onChange={(event) => {
                setActionLabel(event.target.value);
                setEditedActionLabel(true);
              }}
              inputProps={{
                maxLength: 200,
                "data-testid": "work-item-graph-relationship-action-label",
              }}
            />
          )}
          <TextField
            label="Label"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setEditedLabel(true);
            }}
            inputProps={{ "data-testid": "work-item-graph-relationship-label" }}
          />
          <TextField
            label="Description"
            value={description}
            multiline
            minRows={2}
            onChange={(event) => {
              setDescription(event.target.value);
              setEditedDescription(true);
            }}
            inputProps={{
              "data-testid": "work-item-graph-relationship-description",
            }}
          />
          <TextField
            label="Reason"
            value={reasoning}
            multiline
            minRows={2}
            onChange={(event) => {
              setReasoning(event.target.value);
              setEditedReasoning(true);
            }}
            inputProps={{
              "data-testid": "work-item-graph-relationship-reason",
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canCommit}
          onClick={commit}
          data-testid="work-item-graph-relationship-commit"
        >
          {relationship ? "Save" : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
