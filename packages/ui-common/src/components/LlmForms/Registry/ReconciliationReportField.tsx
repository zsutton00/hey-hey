import {
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useCallback, useMemo } from "react";
import { SelectableEntityList } from "../../SelectableEntityList";
import type { SelectableEntityListItem } from "../../SelectableEntityList";
import { CodeSnippetDiff } from "../../shared/CodeSnippetDiff";
import { SEVERITY_CONFIG } from "../../shared/severityConfig";
import type { FieldComponentProps } from "./types";
import {
  type ReconciliationReportCodeChangeItem,
  type ReconciliationReportItemAction,
  type ReconciliationReportProposalItem,
  type ReconciliationReportValue,
  ReconciliationReportNextAction,
  isReconciliationReportValue,
} from "./types";

type CategoryKey = "designDocUpdates" | "codeChanges" | "followUpTasks";

const CATEGORY_CONFIG: Record<
  CategoryKey,
  { title: string; emptyMessage: string }
> = {
  designDocUpdates: {
    title: "Design Document Updates",
    emptyMessage: "No design document updates proposed.",
  },
  codeChanges: {
    title: "Code Changes",
    emptyMessage: "No code changes proposed.",
  },
  followUpTasks: {
    title: "Follow-Up Tasks",
    emptyMessage: "No follow-up tasks proposed.",
  },
};

function countActions(
  items: Array<{ action: ReconciliationReportItemAction }>,
) {
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  for (const item of items) {
    if (item.action === "accept") accepted++;
    else if (item.action === "reject") rejected++;
    else pending++;
  }
  return { accepted, rejected, pending };
}

function StatusChips({
  accepted,
  rejected,
  pending,
}: {
  accepted: number;
  rejected: number;
  pending: number;
}) {
  return (
    <Stack direction="row" spacing={0.5}>
      {accepted > 0 && (
        <Chip
          label={`${accepted} accepted`}
          size="small"
          color="success"
          sx={{ height: 20, fontSize: "0.7rem" }}
        />
      )}
      {rejected > 0 && (
        <Chip
          label={`${rejected} rejected`}
          size="small"
          color="error"
          sx={{ height: 20, fontSize: "0.7rem" }}
        />
      )}
      {pending > 0 && (
        <Chip
          label={`${pending} pending`}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: "0.7rem" }}
        />
      )}
    </Stack>
  );
}

const ReconciliationReportField: React.FC<
  FieldComponentProps<ReconciliationReportValue>
> = ({ value, onChange, isSubmitted, disabled }) => {
  const designDocUpdates = value?.designDocUpdates ?? [];
  const codeChanges = value?.codeChanges ?? [];
  const followUpTasks = value?.followUpTasks ?? [];
  const userMessage = value?.userMessage ?? "";

  const allItems = useMemo(
    () => [...designDocUpdates, ...codeChanges, ...followUpTasks],
    [designDocUpdates, codeChanges, followUpTasks],
  );

  const allDecided = useMemo(
    () =>
      allItems.length > 0 &&
      allItems.every((item) => item.action !== "pending"),
    [allItems],
  );

  const updateItem = useCallback(
    (
      category: CategoryKey,
      id: string,
      patch: Partial<
        ReconciliationReportProposalItem | ReconciliationReportCodeChangeItem
      >,
    ) => {
      if (!value || !onChange) return;

      const patchItem = <T extends { id: string }>(items: T[]): T[] =>
        items.map((item) => (item.id === id ? { ...item, ...patch } : item));

      const updated: ReconciliationReportValue = {
        ...value,
        designDocUpdates:
          category === "designDocUpdates"
            ? patchItem(value.designDocUpdates)
            : value.designDocUpdates,
        codeChanges:
          category === "codeChanges"
            ? patchItem(value.codeChanges)
            : value.codeChanges,
        followUpTasks:
          category === "followUpTasks"
            ? patchItem(value.followUpTasks)
            : value.followUpTasks,
      };

      const allUpdatedItems = [
        ...updated.designDocUpdates,
        ...updated.codeChanges,
        ...updated.followUpTasks,
      ];

      const feedback = allUpdatedItems.map((item) => ({
        id: item.id,
        title:
          "filePath" in item
            ? (item as ReconciliationReportCodeChangeItem).filePath
            : (item as ReconciliationReportProposalItem).title,
        action: item.action,
        comment: item.comment,
      }));

      const everyDecided = allUpdatedItems.every(
        (item) => item.action !== "pending",
      );

      onChange({
        ...updated,
        feedback,
        nextAction: everyDecided
          ? ReconciliationReportNextAction.ReadyForNextStep
          : ReconciliationReportNextAction.ContinueRevising,
      });
    },
    [value, onChange],
  );

  const categoryHandlers = useMemo(() => {
    const categories: CategoryKey[] = [
      "designDocUpdates",
      "codeChanges",
      "followUpTasks",
    ];
    return Object.fromEntries(
      categories.map((cat) => [
        cat,
        {
          onAccept: (id: string) => updateItem(cat, id, { action: "accept" }),
          onReject: (id: string) => updateItem(cat, id, { action: "reject" }),
          onCommentChange: (id: string, comment: string) =>
            updateItem(cat, id, { comment }),
        },
      ]),
    ) as Record<
      CategoryKey,
      {
        onAccept: (id: string) => void;
        onReject: (id: string) => void;
        onCommentChange: (id: string, comment: string) => void;
      }
    >;
  }, [updateItem]);

  const handleUserMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!value || !onChange) return;
      onChange({ ...value, userMessage: e.target.value });
    },
    [value, onChange],
  );

  const designDocListItems = useMemo(
    (): SelectableEntityListItem[] =>
      designDocUpdates.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.action,
        comment: item.comment,
        readOnly: isSubmitted,
      })),
    [designDocUpdates, isSubmitted],
  );

  const followUpTaskListItems = useMemo(
    (): SelectableEntityListItem[] =>
      followUpTasks.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.action,
        comment: item.comment,
        readOnly: isSubmitted,
      })),
    [followUpTasks, isSubmitted],
  );

  const codeChangeToListItems = useMemo(
    (): SelectableEntityListItem[] =>
      codeChanges.map((item) => {
        const severity = SEVERITY_CONFIG[item.severity] ?? SEVERITY_CONFIG.low;
        return {
          id: item.id,
          title: item.filePath,
          description: item.reasoning,
          badgeLabel: severity.label,
          badgeColor: severity.color,
          status: item.action,
          comment: item.comment,
          readOnly: isSubmitted,
          detailContent: (
            <CodeSnippetDiff
              currentSnippet={item.currentSnippet}
              proposedSnippet={item.proposedSnippet}
            />
          ),
        };
      }),
    [codeChanges, isSubmitted],
  );

  const totalCount = allItems.length;

  if (totalCount === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No reconciliation proposals available.
      </Typography>
    );
  }

  const renderSection = (
    category: CategoryKey,
    items: SelectableEntityListItem[],
    counts: { accepted: number; rejected: number; pending: number },
  ) => {
    const config = CATEGORY_CONFIG[category];

    return (
      <Box key={category}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1,
          }}
        >
          <Typography variant="subtitle2" color="text.secondary">
            {config.title} ({items.length})
          </Typography>
          <StatusChips {...counts} />
        </Box>

        {items.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontStyle: "italic", ml: 1 }}
          >
            {config.emptyMessage}
          </Typography>
        ) : (
          <SelectableEntityList
            items={items}
            showActions
            showBackground
            showBorder
            showEntityTypeChip={false}
            entityIconPosition="hidden"
            disabled={disabled || isSubmitted}
            onAccept={categoryHandlers[category].onAccept}
            onReject={categoryHandlers[category].onReject}
            onCommentChange={categoryHandlers[category].onCommentChange}
          />
        )}
      </Box>
    );
  };

  const designDocCounts = countActions(designDocUpdates);
  const codeChangeCounts = countActions(codeChanges);
  const followUpCounts = countActions(followUpTasks);

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="subtitle2">
          {totalCount} proposal{totalCount !== 1 ? "s" : ""} to review
        </Typography>
        <StatusChips {...countActions(allItems)} />
      </Box>

      {renderSection("designDocUpdates", designDocListItems, designDocCounts)}

      {designDocUpdates.length > 0 && codeChanges.length > 0 && <Divider />}

      {renderSection("codeChanges", codeChangeToListItems, codeChangeCounts)}

      {codeChanges.length > 0 && followUpTasks.length > 0 && <Divider />}

      {renderSection("followUpTasks", followUpTaskListItems, followUpCounts)}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
          Feedback or notes
        </Typography>
        <Tooltip
          title={allDecided ? "" : "Review all proposals before submitting"}
        >
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            maxRows={4}
            placeholder="Add feedback, notes on your decisions, or request refinements..."
            value={userMessage}
            onChange={handleUserMessageChange}
            disabled={disabled || isSubmitted}
            variant="outlined"
          />
        </Tooltip>
      </Paper>
    </Stack>
  );
};

export default ReconciliationReportField;

const createReconciliationReportValue = (
  designDocUpdates: ReconciliationReportProposalItem[],
  codeChanges: ReconciliationReportCodeChangeItem[],
  followUpTasks: ReconciliationReportProposalItem[],
): ReconciliationReportValue => ({
  type: "RECONCILIATION_REPORT",
  nextAction: ReconciliationReportNextAction.ContinueRevising,
  userMessage: "",
  designDocUpdates: designDocUpdates.map((item) => ({
    ...item,
    action: item.action ?? "pending",
  })),
  codeChanges: codeChanges.map((item) => ({
    ...item,
    action: item.action ?? "pending",
  })),
  followUpTasks: followUpTasks.map((item) => ({
    ...item,
    action: item.action ?? "pending",
  })),
  feedback: [],
});

export const prepareReconciliationReportInitialValue = (context: {
  baseValue: unknown;
}): ReconciliationReportValue | undefined => {
  if (isReconciliationReportValue(context.baseValue)) {
    return context.baseValue;
  }

  if (
    typeof context.baseValue === "object" &&
    context.baseValue !== null &&
    "codeChanges" in context.baseValue
  ) {
    const raw = context.baseValue as {
      designDocUpdates?: ReconciliationReportProposalItem[];
      codeChanges?: ReconciliationReportCodeChangeItem[];
      followUpTasks?: ReconciliationReportProposalItem[];
    };
    return createReconciliationReportValue(
      Array.isArray(raw.designDocUpdates) ? raw.designDocUpdates : [],
      Array.isArray(raw.codeChanges) ? raw.codeChanges : [],
      Array.isArray(raw.followUpTasks) ? raw.followUpTasks : [],
    );
  }

  return undefined;
};
