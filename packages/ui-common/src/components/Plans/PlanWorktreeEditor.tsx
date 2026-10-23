import {
  Alert,
  Button,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TaskSectionUpdateSource, type PlanConfigurationV1 } from "../../api";
import { useCanonicalPlanMutations } from "../../data";
import type { PlanWorkItem } from "../../data/plans/canonicalPlan";
import { resolveDefaultPlanWorktreeBranch } from "./planWorktreeBranch";

export interface PlanWorktreeEditorProps {
  plan: PlanWorkItem;
  configuration: PlanConfigurationV1;
}

interface WorktreeDraft {
  enabled: boolean;
  branch: string;
}

const buildWorktreeDraft = (worktreeBranch: string | null): WorktreeDraft => ({
  enabled: worktreeBranch !== null,
  branch: worktreeBranch ?? "",
});

const resolveDraftValue = (draft: WorktreeDraft): string | null =>
  draft.enabled ? draft.branch.trim() : null;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : "Unable to save the Plan worktree.";

export const PlanWorktreeEditor: React.FC<PlanWorktreeEditorProps> = ({
  plan,
  configuration,
}) => {
  const [persistedBranch, setPersistedBranch] = useState(
    configuration.worktreeBranch
  );
  const [draft, setDraft] = useState<WorktreeDraft>(() =>
    buildWorktreeDraft(configuration.worktreeBranch)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const { updatePlan } = useCanonicalPlanMutations(
    plan.organizationId,
    plan.projectId
  );

  useEffect(() => {
    setPersistedBranch(configuration.worktreeBranch);
    setDraft(buildWorktreeDraft(configuration.worktreeBranch));
    setSaveError(null);
    setPendingNotice(null);
  }, [configuration.worktreeBranch, plan.id]);

  const resolvedDraftValue = useMemo(() => resolveDraftValue(draft), [draft]);
  const branchMissing = draft.enabled && resolvedDraftValue === "";
  const hasChanges = !branchMissing && resolvedDraftValue !== persistedBranch;

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      setSaveError(null);
      setPendingNotice(null);
      setDraft((currentDraft) => ({
        enabled,
        branch:
          enabled && currentDraft.branch.trim().length === 0
            ? resolveDefaultPlanWorktreeBranch(plan.name)
            : currentDraft.branch,
      }));
    },
    [plan.name]
  );

  const handleSave = useCallback(async () => {
    if (!hasChanges) return;
    setIsSaving(true);
    setSaveError(null);
    setPendingNotice(null);
    try {
      const result = await updatePlan(plan.id, {
        sections: [
          {
            key: "planConfiguration",
            content: {
              ...configuration,
              worktreeBranch: resolvedDraftValue,
            },
          },
        ],
        sectionUpdateSource: TaskSectionUpdateSource.User,
      });
      if (result.status === "pending") {
        setDraft(buildWorktreeDraft(persistedBranch));
        setPendingNotice("The worktree change is awaiting proposal approval.");
        return;
      }
      setPersistedBranch(resolvedDraftValue);
      setDraft(buildWorktreeDraft(resolvedDraftValue));
    } catch (error) {
      setDraft(buildWorktreeDraft(persistedBranch));
      setSaveError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }, [
    configuration,
    hasChanges,
    persistedBranch,
    plan.id,
    resolvedDraftValue,
    updatePlan,
  ]);

  return (
    <Paper
      data-testid="plan-worktree-editor"
      variant="outlined"
      sx={{ p: 2.5 }}
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="subtitle1">Plan worktree</Typography>
          <Typography variant="body2" color="text.secondary">
            New Task sessions use the latest approved branch. Sessions that have
            already started are unchanged.
          </Typography>
        </Stack>

        <FormControlLabel
          control={
            <Switch
              checked={draft.enabled}
              onChange={(event) => handleEnabledChange(event.target.checked)}
              disabled={isSaving}
              data-testid="plan-worktree-editor-toggle"
            />
          }
          label="Use a worktree for this Plan"
        />

        {draft.enabled && (
          <TextField
            label="Branch name"
            value={draft.branch}
            onChange={(event) => {
              setSaveError(null);
              setPendingNotice(null);
              setDraft((currentDraft) => ({
                ...currentDraft,
                branch: event.target.value,
              }));
            }}
            disabled={isSaving}
            error={branchMissing}
            helperText={
              branchMissing
                ? "Branch name is required to use a worktree."
                : undefined
            }
            fullWidth
            size="small"
            data-testid="plan-worktree-editor-branch"
          />
        )}

        {saveError && (
          <Alert severity="error" data-testid="plan-worktree-editor-save-error">
            {saveError}
          </Alert>
        )}
        {pendingNotice && (
          <Alert severity="info" data-testid="plan-worktree-editor-pending">
            {pendingNotice}
          </Alert>
        )}

        <Stack direction="row" justifyContent="flex-end">
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={!hasChanges || isSaving}
            startIcon={
              isSaving ? <CircularProgress size={16} color="inherit" /> : null
            }
            data-testid="plan-worktree-editor-save"
          >
            Save worktree
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
};
