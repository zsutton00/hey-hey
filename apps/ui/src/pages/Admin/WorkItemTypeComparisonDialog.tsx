import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import { DiffRenderer } from "@hey-hey/ui-common/components/SuggestedContent";
import { useWorkItemTypeCanonicalComparison } from "@hey-hey/ui-common/data";
import {
  compareWorkItemTypeDefinitions,
  type ComparisonEntry,
  type ComparisonGroup,
} from "@hey-hey/ui-common/utils";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import React, { useMemo } from "react";
import {
  formatCapabilityKey,
  WORK_ITEM_TYPE_FIELD_PRESENTATION,
  type WorkItemTypeFormField,
} from "./workItemTypeFormPresentation";

export interface WorkItemTypeComparisonDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string | undefined;
  projectId: string | undefined;
  typeKey: string | undefined;
  /** Present only when the caller may reset; reuses the form's confirmation flow. */
  onReset?: () => void;
  resetPending?: boolean;
}

const STATUS_LABEL = {
  unchanged: "Unchanged",
  changed: "Changed",
  added: "Only in project",
  removed: "Only in canonical",
} as const;

const STATUS_COLOR = {
  unchanged: "default",
  changed: "warning",
  added: "success",
  removed: "error",
} as const;

function labelFor(field: string): string {
  const presentation =
    WORK_ITEM_TYPE_FIELD_PRESENTATION[field as WorkItemTypeFormField];

  return presentation?.label ?? field;
}

function ValueBlock({
  title,
  value,
}: {
  title: string;
  value: string | undefined;
}): React.ReactElement {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {title}
      </Typography>
      <Typography
        variant="body2"
        component="pre"
        sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {value ?? "—"}
      </Typography>
    </Box>
  );
}

function LongTextDiff({
  entry,
}: {
  entry: ComparisonEntry;
}): React.ReactElement {
  return (
    <Box data-testid={`wit-compare-linediff-${entry.id}`}>
      <DiffRenderer
        oldContent={entry.canonical ?? ""}
        newContent={entry.project ?? ""}
        viewMode="split"
        splitLabels={{ before: "Canonical", after: "This project" }}
      />
    </Box>
  );
}

function EntryRow({ entry }: { entry: ComparisonEntry }): React.ReactElement {
  const showLineDiff = entry.longText && entry.status !== "unchanged";

  return (
    <Box data-testid={`wit-compare-entry-${entry.id}`} sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">{entry.label}</Typography>
        <Chip
          size="small"
          label={STATUS_LABEL[entry.status]}
          color={STATUS_COLOR[entry.status]}
          variant="outlined"
        />
      </Stack>
      {showLineDiff ? (
        <LongTextDiff entry={entry} />
      ) : (
        <Stack direction="row" spacing={2}>
          <ValueBlock title="This project" value={entry.project} />
          <ValueBlock title="Canonical" value={entry.canonical} />
        </Stack>
      )}
    </Box>
  );
}

function GroupSection({
  group,
}: {
  group: ComparisonGroup;
}): React.ReactElement {
  const differing = group.entries.filter((e) => e.status !== "unchanged");
  const unchanged = group.entries.filter((e) => e.status === "unchanged");

  return (
    <Accordion
      defaultExpanded={differing.length > 0}
      disableGutters
      data-testid={`wit-compare-group-${group.id}`}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1">{group.id}</Typography>
        <Chip
          size="small"
          sx={{ ml: 1 }}
          color={differing.length > 0 ? "warning" : "default"}
          label={
            differing.length > 0
              ? `${differing.length} difference${differing.length === 1 ? "" : "s"}`
              : "No differences"
          }
        />
      </AccordionSummary>
      <AccordionDetails>
        {differing.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
        {unchanged.length > 0 ? (
          <Accordion
            disableGutters
            variant="outlined"
            data-testid={`wit-compare-unchanged-${group.id}`}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" color="text.secondary">
                {unchanged.length} unchanged
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {unchanged.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </AccordionDetails>
          </Accordion>
        ) : null}
      </AccordionDetails>
    </Accordion>
  );
}

export const WorkItemTypeComparisonDialog: React.FC<
  WorkItemTypeComparisonDialogProps
> = ({
  open,
  onClose,
  organizationId,
  projectId,
  typeKey,
  onReset,
  resetPending,
}) => {
  const { data, isLoading, error } = useWorkItemTypeCanonicalComparison(
    organizationId,
    projectId,
    typeKey,
    open,
  );
  const comparison = useMemo(
    () =>
      data
        ? compareWorkItemTypeDefinitions(
            data.effective.definition,
            data.canonical,
            labelFor,
            formatCapabilityKey,
          )
        : undefined,
    [data],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Compare with canonical</DialogTitle>
      <DialogContent>
        <Stack spacing={1} data-testid="wit-compare-dialog">
          {isLoading ? <CircularProgress /> : null}
          {error ? (
            <Alert severity="error">
              The canonical definition could not be loaded.
            </Alert>
          ) : null}
          {comparison && !comparison.hasDifferences ? (
            <Alert severity="success" data-testid="wit-compare-matches">
              This override matches the current canonical definition.
            </Alert>
          ) : null}
          {comparison?.groups.map((group) => (
            <GroupSection key={group.id} group={group} />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        {onReset ? (
          <Button
            color="primary"
            variant="outlined"
            disabled={resetPending}
            onClick={onReset}
            data-testid="wit-compare-reset-to-canonical"
          >
            Reset to canonical
          </Button>
        ) : null}
        <Button onClick={onClose} data-testid="wit-compare-close">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
