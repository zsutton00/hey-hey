import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import { useEffect, useMemo, useState, type FC } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  EntityType,
  type ProjectedWorkItemRelationship,
  type WorkItemChangeSetIdentity,
  type WorkItemTypeGraphRelationshipDeclaration,
  type WorkItemTypeGraphSearchableMetaLinkTarget,
} from "../../api";
import {
  useWorkItemGraphMetaLinkSearch,
  type WorkItemGraphMetaLinkTarget,
} from "../../data/hooks/useWorkItemGraphMetaLinkSearch";
import { workItemIdentityKey } from "./workItemGraphLayout";

export interface WorkItemGraphMetaLinkDialogProps {
  open: boolean;
  organizationId: string | null;
  projectId: string | null;
  sourceChild: WorkItemChangeSetIdentity | null;
  relationshipDeclaration: WorkItemTypeGraphRelationshipDeclaration | null;
  searchTarget: WorkItemTypeGraphSearchableMetaLinkTarget | null;
  existingTargets: readonly WorkItemChangeSetIdentity[];
  relationship?: ProjectedWorkItemRelationship | null;
  onCancel: () => void;
  onCommit: (value: WorkItemGraphMetaLinkDialogValue) => void;
}

export interface WorkItemGraphMetaLinkDialogValue {
  target: WorkItemGraphMetaLinkTarget;
  reasoning?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
}

export const WorkItemGraphMetaLinkDialog: FC<
  WorkItemGraphMetaLinkDialogProps
> = ({
  open,
  organizationId,
  projectId,
  sourceChild,
  relationshipDeclaration,
  searchTarget,
  existingTargets,
  relationship = null,
  onCancel,
  onCommit,
}) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [editedLabel, setEditedLabel] = useState(false);
  const [editedDescription, setEditedDescription] = useState(false);
  const [editedReasoning, setEditedReasoning] = useState(false);
  const search = useWorkItemGraphMetaLinkSearch({
    organizationId: open ? organizationId : null,
    projectId: open ? projectId : null,
    sourceChild: open ? sourceChild : null,
    searchTarget,
    query,
  });
  const existingTargetKeys = useMemo(
    () => new Set(existingTargets.map(workItemIdentityKey)),
    [existingTargets],
  );
  const selectableResults = useMemo(
    () =>
      search.results.filter(
        (result) =>
          !existingTargetKeys.has(workItemIdentityKey(result.identity)),
      ),
    [existingTargetKeys, search.results],
  );
  const selected =
    relationship?.target.refType === "existing"
      ? {
          identity: relationship.target,
          entityType: EntityType.Task,
          title: relationship.label,
          workItemTypeKey: "",
        }
      : selectableResults.find((result) => result.identity.id === selectedId);

  useEffect(() => {
    setSelectedId(null);
  }, [query, searchTarget, sourceChild]);

  useEffect(() => {
    if (open) {
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
    } else {
      setQuery("");
      setSelectedId(null);
    }
  }, [open, relationship]);

  const commit = () => {
    if (!selected || (!relationship && !search.isSelectable)) return;
    const metadataEdited = editedLabel || editedDescription;
    onCommit({
      target: selected,
      ...(metadataEdited
        ? {
            metadata: {
              ...(relationship?.metadata ?? {}),
              ...(editedLabel ? { label: label.trim() || null } : {}),
              ...(editedDescription
                ? { description: description.trim() || null }
                : {}),
            },
          }
        : {}),
      ...(editedReasoning ? { reasoning: reasoning.trim() || null } : {}),
    });
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>
        {relationshipDeclaration
          ? `${relationship ? "Edit" : "Add"} ${relationshipDeclaration.edgeType}`
          : "Add related work item"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {!relationship && (
            <TextField
              autoFocus
              label="Search this project"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              inputProps={{ "data-testid": "work-item-graph-meta-search" }}
            />
          )}
          {!relationship && search.status === "loading" && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">Searching…</Typography>
            </Stack>
          )}
          {!relationship && search.status === "error" && (
            <Alert severity="error">{search.error.message}</Alert>
          )}
          {!relationship &&
            (search.status === "empty" ||
              (search.status === "success" &&
                selectableResults.length === 0)) && (
              <Typography variant="body2" color="text.secondary">
                No eligible results.
              </Typography>
            )}
          {!relationship &&
            search.status === "success" &&
            selectableResults.length > 0 && (
              <List data-testid="work-item-graph-meta-results" disablePadding>
                {selectableResults.map((result) => (
                  <ListItemButton
                    key={result.identity.id}
                    selected={result.identity.id === selectedId}
                    onClick={() => setSelectedId(result.identity.id)}
                    data-testid="work-item-graph-meta-result"
                    data-entity-id={result.identity.id}
                  >
                    <ListItemText
                      primary={result.title}
                      secondary={result.workItemTypeKey}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          <TextField
            label="Label"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setEditedLabel(true);
            }}
            inputProps={{ "data-testid": "work-item-graph-meta-label" }}
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
            inputProps={{ "data-testid": "work-item-graph-meta-description" }}
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
            inputProps={{ "data-testid": "work-item-graph-meta-reason" }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!selected || (!relationship && !search.isSelectable)}
          onClick={commit}
          data-testid="work-item-graph-meta-commit"
        >
          {relationship ? "Save link" : "Add link"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
