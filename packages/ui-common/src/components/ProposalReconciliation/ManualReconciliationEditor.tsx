import { preserveUnaffectedRequirements } from "./scopedResolution";
import { projectThreeWayReview } from "./threeWayProjection";
import { manualReconciliationContent } from "./manualReconciliationContent";
import { useCallback, useState } from "react";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import {
  type ProposalResponseDto,
  type ProposalReconciliationState,
} from "../../api";
import { useMentionEntitySearch } from "../../data/hooks/useMentionEntitySearch";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { ScopedResolutionEditor } from "./ScopedResolutionEditor";
import { ManualGraphResolutionEditor } from "./ManualGraphResolutionEditor";
import { isFutureProposal } from "../ProposalDispatchers/futureAsUpdate";
import type { ProjectedWorkItemChangeSetResponse } from "../../api";

/** Complete values are retained; editing never refreshes the reviewed basis. */
export function ManualReconciliationEditor({
  proposal,
  state,
  busy,
  error,
  onSave,
  onClose,
}: {
  proposal: ProposalResponseDto;
  state: ProposalReconciliationState;
  busy: boolean;
  error: string | null;
  onSave: (result: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const original = state.revisions.find(
    (revision) => revision.id === state.candidateRevisionId,
  )?.proposedResult;
  const [result, setResult] = useState<Record<string, unknown>>(() =>
    preserveUnaffectedRequirements(
      manualReconciliationContent(proposal, state),
      projectThreeWayReview(proposal, state),
    ),
  );
  const {
    workItemTypes,
    isLoading,
    error: registryError,
  } = useWorkItemTypes(proposal.organizationId, {
    projectId: proposal.projectId,
  });
  const { searchEntities } = useMentionEntitySearch(
    proposal.organizationId,
    proposal.projectId,
    null,
  );
  const definition = workItemTypes.find(
    (item) => item.definition.key === result.type,
  )?.definition;
  const graph =
    isFutureProposal(proposal) &&
    proposal.updates.operation === "REVISE" &&
    "type" in proposal.updates.result
      ? proposal.updates.result.graph
      : undefined;
  const childDefinition = workItemTypes.find(
    (item) =>
      item.definition.key === definition?.capabilities?.graph?.nodeChildType,
  )?.definition;
  const changeGraph = useCallback(
    (next: ProjectedWorkItemChangeSetResponse) =>
      setResult((current) => ({
        ...current,
        graph: next,
        name: next.projectedRoot.name,
        priority: next.projectedRoot.priority,
        tag: next.projectedRoot.tag,
        assigneeId: next.projectedRoot.assigneeId ?? null,
        dueDate: next.projectedRoot.dueDate ?? null,
        sections: next.projectedRoot.sections.map((section, order) => {
          const previous = (current.sections as { key: string }[]).find(
            (entry) => entry.key === section.key,
          );
          return {
            // New sections reserve a real identity and have no applied provenance yet.
            ...(previous ?? {
              id: crypto.randomUUID(),
              materializedProposalId: "",
            }),
            key: section.key,
            order,
            materializedMarkdown:
              typeof section.content === "string"
                ? section.content
                : JSON.stringify(section.content),
          };
        }),
      })),
    [],
  );
  const save = () => onSave(result);
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      data-testid="proposal-reconciliation-manual-editor"
    >
      <Typography variant="h6">Edit resolved content</Typography>
      <Stack spacing={2}>
        <Typography>
          This replaces the proposal’s current content and clears its approvals.
          Live content will not change.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {registryError && (
          <Alert severity="error">{registryError.message}</Alert>
        )}
        {graph && definition && childDefinition ? (
          <ManualGraphResolutionEditor
            graph={graph}
            definition={definition}
            childDefinition={childDefinition}
            organizationId={proposal.organizationId}
            projectId={proposal.projectId}
            disabled={busy}
            onChange={changeGraph}
          />
        ) : graph ? (
          <Alert severity="error">
            The graph's type definitions are unavailable. Refresh before
            editing.
          </Alert>
        ) : null}
        {!graph && (
          <ScopedResolutionEditor
            proposal={proposal}
            state={state}
            result={result}
            onChange={setResult}
            disabled={busy}
            context={{
              organizationId: proposal.organizationId,
              projectId: proposal.projectId,
              featureId: proposal.targetEntityId,
              parentId:
                typeof result.parentTaskId === "string"
                  ? result.parentTaskId
                  : null,
              onSearchEntities: searchEntities,
            }}
          />
        )}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={
            busy ||
            !original ||
            isLoading ||
            !!registryError ||
            (!!graph && (!definition || !childDefinition))
          }
          onClick={save}
          data-testid="proposal-reconciliation-manual-save"
        >
          Update proposal
        </Button>
      </Stack>
    </Paper>
  );
}
