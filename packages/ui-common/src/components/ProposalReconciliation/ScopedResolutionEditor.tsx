import { ResolutionTextEditor } from "./ResolutionTextEditor";
import { CheckOutlined, EditOutlined } from "@mui/icons-material";
import { useState } from "react";
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  Tooltip,
} from "@mui/material";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../api";
import {
  SingleRequirementEditor,
  type FeatureRequirementsEditorContext,
} from "../WorkItem/FeatureRequirementsSectionEditor";
import { StructuredRequirementsView } from "../shared/StructuredRequirementsView";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { ReconciliationValue } from "./ReconciliationValue";
import {
  reconciliationFieldLabel,
  type ReconciliationPresentation,
} from "./reconciliationPresentation";
import {
  equivalentContent,
  normalizeReconciliationContent,
  projectThreeWayReview,
  threeWayValue,
} from "./threeWayProjection";
import {
  records,
  resolutionItems,
  resolutionConflictPaths,
  writeResolution,
  type ResolutionItem,
} from "./scopedResolution";

export function ScopedResolutionEditor({
  proposal,
  state,
  result,
  onChange,
  context,
  disabled,
}: {
  proposal: ProposalResponseDto;
  state: ProposalReconciliationState;
  result: Record<string, unknown>;
  onChange: (result: Record<string, unknown>) => void;
  context: FeatureRequirementsEditorContext;
  disabled: boolean;
}) {
  const projection = projectThreeWayReview(proposal, state);
  const registry = useWorkItemTypes(proposal.organizationId, {
    projectId: proposal.projectId,
  });
  const definition = registry.workItemTypes.find(
    (item) => item.definition.key === projection.live?.type,
  )?.definition;
  const presentation: ReconciliationPresentation =
    proposal.targetEntityType === "DESIGN_DOC"
      ? { kind: "design-doc" }
      : { kind: "work-item", definition };
  const items = resolutionItems(
    projection,
    resolutionConflictPaths(projection, state),
  );
  const [editing, setEditing] = useState<{
    item: ResolutionItem;
    value: unknown;
  } | null>(null);
  const normalized = normalizeReconciliationContent(result);
  const display = (item: ResolutionItem, value: unknown) => {
    if (item.requirementId && value)
      return (
        <StructuredRequirementsView
          requirements={records({ records: [value] }) ?? []}
        />
      );
    return (
      <ReconciliationValue
        value={value}
        original={undefined}
        branch={false}
        section={definition?.sections.find(
          (section) => item.path === `sections.${section.key}`,
        )}
        typeKey={definition?.key}
      />
    );
  };
  const editedRecord =
    editing?.item.requirementId && editing.value
      ? records({ records: [editing.value] })?.[0]
      : undefined;
  return (
    <Stack spacing={2}>
      {items.map((item) => {
        const value = threeWayValue(normalized, item.path);
        const selected = item.requirementId
          ? records(value)?.find((r) => r.id === item.requirementId)
          : value;
        const currentSelected = equivalentContent(selected, item.current);
        const proposedSelected =
          !currentSelected && equivalentContent(selected, item.proposed);
        const custom = !currentSelected && !proposedSelected;
        return (
          <Box
            key={`${item.path}:${item.requirementId ?? ""}`}
            data-testid="resolution-item"
            sx={{ border: 1, borderColor: "divider", p: 2 }}
          >
            <Typography variant="subtitle2">
              {item.requirementId
                ? "Requirement"
                : reconciliationFieldLabel(item.path, presentation)}
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="subtitle2">Current</Typography>
                {display(item, item.current)}
              </Box>
              <Box>
                <Typography variant="subtitle2">Proposed result</Typography>
                {display(item, selected)}
              </Box>
              <Box data-testid="resolution-current-actions">
                <Tooltip
                  describeChild
                  title={
                    item.current === undefined
                      ? "Remove this addition from the proposed result. Live content stays unchanged."
                      : "Copy the current live content into the proposed result for this item."
                  }
                >
                  <span>
                    <Button
                      variant={currentSelected ? "contained" : "outlined"}
                      aria-pressed={currentSelected}
                      startIcon={
                        currentSelected ? <CheckOutlined /> : undefined
                      }
                      disabled={disabled}
                      onClick={() =>
                        onChange(writeResolution(result, item, item.current))
                      }
                    >
                      {item.current === undefined
                        ? "Remove addition"
                        : "Use current"}
                    </Button>
                  </span>
                </Tooltip>
              </Box>
              <Stack
                data-testid="resolution-proposed-actions"
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
              >
                <Tooltip
                  describeChild
                  title={
                    item.current === undefined
                      ? "Keep the original proposed addition, replacing any local edits to it."
                      : "Use the original proposal's version of this item, replacing any local edits."
                  }
                >
                  <span>
                    <Button
                      variant={proposedSelected ? "contained" : "outlined"}
                      aria-pressed={proposedSelected}
                      startIcon={
                        proposedSelected ? <CheckOutlined /> : undefined
                      }
                      disabled={disabled}
                      onClick={() =>
                        onChange(writeResolution(result, item, item.proposed))
                      }
                    >
                      {item.current === undefined
                        ? "Keep addition"
                        : "Keep proposal"}
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip
                  describeChild
                  title="Open an editor for this item. Saving updates the proposed result, not live content."
                >
                  <span>
                    <Button
                      variant="text"
                      startIcon={<EditOutlined />}
                      disabled={
                        disabled ||
                        (item.requirementId
                          ? !selected
                          : typeof selected !== "string")
                      }
                      onClick={() =>
                        setEditing({ item, value: structuredClone(selected) })
                      }
                    >
                      {custom ? "Edit (custom)" : "Edit"}
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            </Box>
          </Box>
        );
      })}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editing?.item.requirementId
            ? "Edit requirement"
            : "Edit proposed content"}
        </DialogTitle>
        <DialogContent>
          {editedRecord ? (
            <SingleRequirementEditor
              record={editedRecord}
              context={context}
              disabled={disabled}
              onChange={(value) =>
                setEditing((previous) => previous && { ...previous, value })
              }
            />
          ) : (
            <ResolutionTextEditor
              label="Proposed content"
              disabled={disabled}
              organizationId={proposal.organizationId}
              projectId={proposal.projectId}
              value={typeof editing?.value === "string" ? editing.value : ""}
              onChange={(value) =>
                setEditing((previous) => previous && { ...previous, value })
              }
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button
            disabled={disabled}
            onClick={() => {
              if (editing)
                onChange(writeResolution(result, editing.item, editing.value));
              setEditing(null);
            }}
          >
            Save edit
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
