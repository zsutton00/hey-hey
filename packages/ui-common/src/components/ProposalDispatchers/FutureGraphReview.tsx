import { Stack, Typography } from "@mui/material";
import type { FutureRevisionUpdate } from "../../api";
import { WorkflowGraphSurface } from "../shared/WorkflowMentionInlineRenderer";
import { hydrateValidatedWorkItemGraphProjection } from "../shared/workItemGraphDraft";
import { WorkItemGraphChangeSummary } from "./WorkItemGraphChangeSummary";

/** Both sides are captured review content. Live reads cannot rewrite this review. */
export function FutureGraphReview({
  mutation,
  organizationId,
  projectId,
}: {
  mutation: FutureRevisionUpdate;
  organizationId: string;
  projectId: string;
}) {
  const before =
    "type" in mutation.baseline.content
      ? mutation.baseline.content.graph
      : undefined;
  const after = "type" in mutation.result ? mutation.result.graph : undefined;
  if (!before || !after || !mutation.graphChangeSet) return null;
  const operations = mutation.graphChangeSet.operations;
  const beforeProjection = hydrateValidatedWorkItemGraphProjection(before, []);
  const afterProjection = hydrateValidatedWorkItemGraphProjection(
    after,
    operations,
  );
  return (
    <Stack spacing={2} data-testid="future-graph-review">
      <Typography variant="subtitle2">Selected baseline</Typography>
      <WorkflowGraphSurface
        mode="view"
        organizationId={organizationId}
        projectId={projectId}
        projection={beforeProjection}
        participation={null}
        allowFullscreen
      />
      <Typography variant="subtitle2">Reviewed future</Typography>
      <WorkflowGraphSurface
        mode="view"
        organizationId={organizationId}
        projectId={projectId}
        projection={afterProjection}
        participation={null}
        allowFullscreen
      />
      <WorkItemGraphChangeSummary
        operations={operations}
        projection={afterProjection}
      />
    </Stack>
  );
}
