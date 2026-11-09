import { Box, Chip, Stack, Typography } from "@mui/material";
import {
  type ProposalEdgeDeclaration,
  ProposalEdgeType,
  type RelationshipDecision,
  RelationshipDecisionKind,
  type WorkItemChangeSetIdentity,
} from "../../api";

interface RelationshipDecisionsReviewProps {
  decisions: readonly RelationshipDecision[];
  /** Work items this proposal replaces through SUPERSEDES. */
  supersededIds: ReadonlySet<string>;
  /** What the new work item is called when a replacement points at it. */
  newItemName: string;
}

const DECISION_LABELS: Record<
  RelationshipDecisionKind,
  { label: string; color: "default" | "error" | "primary" }
> = {
  [RelationshipDecisionKind.Retain]: { label: "Kept", color: "default" },
  [RelationshipDecisionKind.Remove]: { label: "Removed", color: "error" },
  [RelationshipDecisionKind.Replace]: { label: "Moved", color: "primary" },
};

/** Ids of the work items a proposal replaces through SUPERSEDES edges. */
export const supersededIds = (
  edges: readonly ProposalEdgeDeclaration[] | undefined,
): ReadonlySet<string> =>
  new Set(
    (edges ?? [])
      .filter((edge) => edge.edgeType === ProposalEdgeType.Supersedes)
      .map((edge) => edge.targetEntityId),
  );

const edgeLabel = (edgeType: string): string =>
  edgeType.toLowerCase().replace(/_/g, " ");

/**
 * Shows what happens to each existing connection a replacement touches.
 * Kept connections are review evidence only: they are listed here and never
 * appear as added or changed graph state.
 */
export const RelationshipDecisionsReview = ({
  decisions,
  supersededIds,
  newItemName,
}: RelationshipDecisionsReviewProps) => {
  if (decisions.length === 0) {
    return null;
  }

  const nameOf = (
    decision: RelationshipDecision,
    identity: WorkItemChangeSetIdentity,
  ): string => {
    if (identity.refType === "temporary") {
      return newItemName;
    }
    const recorded = decision.replacementEndpoints?.find(
      (endpoint) => endpoint.id === identity.id,
    );
    return recorded?.name ?? "Unavailable work item";
  };

  return (
    <Stack spacing={1} data-testid="relationship-decisions-review">
      <Typography variant="subtitle2">Connections affected</Typography>
      {decisions.map((decision) => {
        const { label, color } = DECISION_LABELS[decision.decision];
        const original = decision.original;
        const staysOnReplacedItem =
          decision.decision === RelationshipDecisionKind.Retain &&
          !!original &&
          (supersededIds.has(original.source.id) ||
            supersededIds.has(original.target.id));

        return (
          <Box
            key={decision.relationship.id}
            data-testid="relationship-decision"
            data-decision={decision.decision}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={label} color={color} />
              {staysOnReplacedItem && (
                <Chip
                  size="small"
                  color="warning"
                  label="Still points at the replaced item"
                />
              )}
              {original && (
                <Typography variant="body2">
                  {original.source.name} {edgeLabel(original.edgeType)}{" "}
                  {original.target.name}
                </Typography>
              )}
            </Stack>
            {original?.description && (
              <Typography variant="caption" color="text.secondary">
                {original.description}
              </Typography>
            )}
            {decision.reason && (
              <Typography variant="body2">Why: {decision.reason}</Typography>
            )}
            {decision.replacement && (
              <Typography variant="body2">
                Becomes: {nameOf(decision, decision.replacement.source)}{" "}
                {edgeLabel(decision.replacement.edgeType)}{" "}
                {nameOf(decision, decision.replacement.target)}
              </Typography>
            )}
          </Box>
        );
      })}
    </Stack>
  );
};
