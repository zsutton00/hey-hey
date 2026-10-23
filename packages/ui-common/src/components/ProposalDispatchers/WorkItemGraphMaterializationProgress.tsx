import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import PendingOutlinedIcon from "@mui/icons-material/PendingOutlined";
import SyncIcon from "@mui/icons-material/Sync";
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { FC } from "react";
import {
  AgentEdgeCategory,
  AgentEdgeType,
  WorkItemChangeSetMaterializationState,
  WorkItemChangeSetOperationProgressStatusEnum,
  type ProjectedWorkItemRelationship,
  type WorkItemChangeSetMaterializationProgress as MaterializationProgress,
  type WorkItemChangeSetOperation,
  type WorkItemChangeSetOperationProgress,
  type WorkItemChangeSetRelationshipIdentity,
} from "../../api";
import { ProposalFailureDiagnostic } from "./ProposalFailureDiagnostic";

export interface WorkItemGraphMaterializationProgressProps {
  progress: MaterializationProgress;
  operations: readonly WorkItemChangeSetOperation[];
  relationships: readonly ProjectedWorkItemRelationship[];
}

function relationshipIdentityKey(
  identity: WorkItemChangeSetRelationshipIdentity,
): string {
  return identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

function relationshipForOperation(
  operation: WorkItemChangeSetOperation | undefined,
  relationships: readonly ProjectedWorkItemRelationship[],
): ProjectedWorkItemRelationship | undefined {
  switch (operation?.op) {
    case "relationship.create":
    case "relationship.update":
    case "relationship.delete":
      return relationships.find(
        (relationship) =>
          relationshipIdentityKey(relationship.identity) ===
          relationshipIdentityKey(operation.ref),
      );
    default:
      return undefined;
  }
}

function relationshipCategoryLabel(
  operation: WorkItemChangeSetOperation | undefined,
  relationships: readonly ProjectedWorkItemRelationship[],
): string | null {
  if (!operation?.op.startsWith("relationship.")) return null;
  const projected = relationshipForOperation(operation, relationships);
  const category =
    operation.op === "relationship.create" ||
    operation.op === "relationship.update"
      ? operation.category ?? projected?.category
      : projected?.category;
  const edgeType =
    operation.op === "relationship.create" ||
    operation.op === "relationship.update"
      ? operation.edgeType ?? projected?.edgeType
      : projected?.edgeType;

  if (category === AgentEdgeCategory.Flow) return "Flow relationship";
  if (edgeType === AgentEdgeType.FulfilledBy) return "Fulfillment relationship";
  return "Meta relationship";
}

function operationLabel(
  checkpoint: WorkItemChangeSetOperationProgress,
  operation: WorkItemChangeSetOperation | undefined,
  relationships: readonly ProjectedWorkItemRelationship[],
): string {
  const relationshipLabel = relationshipCategoryLabel(operation, relationships);
  if (relationshipLabel)
    return `${relationshipLabel} · ${checkpoint.operationKind}`;
  return checkpoint.operationKind;
}

function checkpointIcon(status: WorkItemChangeSetOperationProgress["status"]) {
  switch (status) {
    case WorkItemChangeSetOperationProgressStatusEnum.Completed:
      return <CheckCircleOutlineIcon color="success" fontSize="small" />;
    case WorkItemChangeSetOperationProgressStatusEnum.Applying:
      return <SyncIcon color="primary" fontSize="small" />;
    case WorkItemChangeSetOperationProgressStatusEnum.Failed:
      return <ErrorOutlineIcon color="error" fontSize="small" />;
    case WorkItemChangeSetOperationProgressStatusEnum.Pending:
      return <PendingOutlinedIcon color="disabled" fontSize="small" />;
  }
}

function lifecycleLabel(progress: MaterializationProgress): string {
  if (progress.state === WorkItemChangeSetMaterializationState.Published) {
    return "Materialization complete";
  }
  if (progress.state === WorkItemChangeSetMaterializationState.Applying) {
    return "Materialization in progress";
  }
  return progress.lastError ? "Materialization paused" : "Ready to materialize";
}

export const WorkItemGraphMaterializationProgress: FC<
  WorkItemGraphMaterializationProgressProps
> = ({ progress, operations, relationships }) => {
  const completed = progress.operations.filter(
    (operation) =>
      operation.status ===
      WorkItemChangeSetOperationProgressStatusEnum.Completed,
  ).length;
  const total = progress.operations.length;
  const percentage = total === 0 ? 0 : (completed / total) * 100;

  return (
    <Stack
      spacing={1.5}
      data-testid="work-item-graph-materialization-progress"
      data-materialization-state={progress.state}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography variant="subtitle2">{lifecycleLabel(progress)}</Typography>
        <Chip
          size="small"
          variant="outlined"
          label={`${completed} of ${total} operations complete`}
        />
        {progress.attemptCount > 0 ? (
          <Chip
            size="small"
            variant="outlined"
            label={`Attempt ${progress.attemptCount}`}
          />
        ) : null}
      </Stack>
      <LinearProgress
        variant="determinate"
        value={percentage}
        aria-label="Materialization completion"
      />
      {progress.lastError ? (
        <Alert severity="error">{progress.lastError}</Alert>
      ) : null}
      <ProposalFailureDiagnostic diagnostic={progress.diagnostic} />
      <Stack spacing={0.75}>
        {progress.operations.map((checkpoint) => {
          const operation = operations[checkpoint.operationIndex];
          return (
            <Box
              key={checkpoint.operationIndex}
              data-testid="work-item-graph-operation-checkpoint"
              data-operation-index={checkpoint.operationIndex}
              data-operation-kind={checkpoint.operationKind}
              data-operation-status={checkpoint.status}
              sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}
            >
              {checkpointIcon(checkpoint.status)}
              <Box>
                <Typography variant="body2">
                  {operationLabel(checkpoint, operation, relationships)}
                </Typography>
                {checkpoint.lastError ? (
                  <Typography variant="caption" color="error.main">
                    {checkpoint.lastError}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
};
