import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { WorktreeSetupControls } from "../AgentSession/WorktreeSetupControls";
import { MarkdownLexicalEditor } from "../LexicalEditor/MarkdownLexicalEditor";

/** Branch typing settles before it is saved, so one pause is one save. */
const WORKTREE_SAVE_DELAY_MS = 600;

/** One titled group of monitor-wide settings with a one-line explanation. */
export function TaskMonitorSettingsSection({
  title,
  explanation,
  optional = false,
  testId,
  children,
}: {
  title: string;
  explanation: string;
  optional?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={title}
      data-testid={testId}
      sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}
    >
      <Box>
        <Typography
          variant="subtitle1"
          component="h3"
          fontWeight={600}
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          {title}
          {optional ? <Chip label="optional" size="small" /> : null}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {explanation}
        </Typography>
      </Box>
      {children}
    </Paper>
  );
}

/**
 * The shared branch every task session runs on, editable only before Start.
 * Render-only; a settled change is reported through the callback.
 */
export function TaskMonitorWorktreeBranchSetting({
  worktreeBranch,
  onChangeWorktreeBranch,
  onWorktreeBranchPendingChange,
}: {
  worktreeBranch: string | null;
  onChangeWorktreeBranch: (branch: string | null) => void;
  /**
   * True while the branch shown differs from the saved one (waiting to save,
   * saving, or failed to save). Start reads the saved branch, so it must wait.
   */
  onWorktreeBranchPendingChange: (pending: boolean) => void;
}) {
  const [branchDraft, setBranchDraft] = useState(worktreeBranch);
  // The parent passes a new callback each render; keeping the latest in a ref
  // stops every re-render from restarting the save delay.
  const saveBranch = useRef(onChangeWorktreeBranch);
  saveBranch.current = onChangeWorktreeBranch;
  const branchPending = branchDraft !== worktreeBranch;

  useEffect(() => {
    setBranchDraft(worktreeBranch);
  }, [worktreeBranch]);

  useEffect(() => {
    onWorktreeBranchPendingChange(branchPending);
  }, [branchPending, onWorktreeBranchPendingChange]);

  useEffect(() => {
    if (!branchPending) {
      return;
    }
    const timer = setTimeout(
      () => saveBranch.current(branchDraft),
      WORKTREE_SAVE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [branchDraft, branchPending]);

  return (
    <Box data-testid="task-monitor-worktree">
      <Typography variant="subtitle2">Worktree</Typography>
      <Typography variant="body2" color="text.secondary">
        Run every task session on a shared branch.
      </Typography>
      <WorktreeSetupControls
        branch={branchDraft}
        locked={false}
        onChangeBranch={setBranchDraft}
        toggleTestId="task-monitor-worktree-toggle"
        controlsTestId="task-monitor-worktree-controls"
        branchTestId="task-monitor-worktree-branch-name"
      />
      {branchDraft !== null && branchDraft.trim().length === 0 ? (
        <Alert
          severity="error"
          sx={{ mt: 1.5 }}
          data-testid="task-monitor-worktree-branch-error"
        >
          Enter a branch name before starting the Task Monitor.
        </Alert>
      ) : null}
    </Box>
  );
}

/** The optional guidance sent with Start; a browser draft, never stored. */
export function TaskMonitorGuidanceSetting({
  startMessage,
  onChangeStartMessage,
}: {
  startMessage: string;
  onChangeStartMessage: (message: string) => void;
}) {
  return (
    <Stack spacing={0.5} data-testid="task-monitor-start-message">
      <MarkdownLexicalEditor
        value={startMessage}
        onTextChange={onChangeStartMessage}
        isLoading={false}
        placeholder="Add an optional message for the Task Monitor…"
      />
      <Typography variant="caption" color="text.secondary">
        Sent with Start. It is not stored on the Task Monitor.
      </Typography>
    </Stack>
  );
}
