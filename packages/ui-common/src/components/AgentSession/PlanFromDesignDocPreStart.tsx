import {
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import React from "react";
import {
  PlanCombinationAggressiveness,
  type PlanCombinationAggressiveness as PlanCombinationAggressivenessValue,
} from "../../api";
import type {
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../api";
import { DesignDocReadView } from "../shared/DesignDocReadView";
import { RuntimeModelSelector } from "./RuntimeModelSelector";
import type { ModelSelectorMachineSelectionProps } from "./ModelSelector";
import type { PlanFromDesignDocSeed } from "./usePlanFromDesignDocSeed";

export interface PlanFromDesignDocPreStartProps {
  organizationId: string;
  projectId: string;
  navigate: (url: string) => void;
  seed: PlanFromDesignDocSeed | null;
  isLoadingSeed: boolean;
  isStarting: boolean;
  onStartGenerating: () => void;
  /**
   * Navigates to the seed design doc's page in edit mode. Omitted when the
   * plan has no resolvable design-doc relationship, in which case the "Edit
   * design doc" button is not rendered.
   */
  onEditDesignDoc?: () => void;
  /** Whether an execution-ready Agent Bridge is selected. */
  isBridgeSelected?: boolean;
  /** Null until the picked machine's CLI catalog has loaded. */
  provider: ConversationStartRunRequestDtoProviderEnum | null;
  model: string | null;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  fastMode: boolean;
  onProviderChange: (
    provider: ConversationStartRunRequestDtoProviderEnum,
  ) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (
    effort: ConversationStartRunRequestDtoReasoningEffortEnum | null,
  ) => void;
  onFastModeChange: (fastMode: boolean) => void;
  machineSelection: ModelSelectorMachineSelectionProps;
  worktreeEnabled: boolean;
  worktreeBranch: string;
  onWorktreeEnabledChange: (enabled: boolean) => void;
  onWorktreeBranchChange: (branch: string) => void;
  planCombinationAggressiveness: PlanCombinationAggressivenessValue;
  onPlanCombinationAggressivenessChange: (
    value: PlanCombinationAggressivenessValue,
  ) => void;
}

const isWorktreeBranchMissing = (
  worktreeEnabled: boolean,
  worktreeBranch: string,
): boolean => worktreeEnabled && worktreeBranch.trim().length === 0;

const PLAN_COMBINATION_AGGRESSIVENESS_OPTIONS = [
  {
    value: PlanCombinationAggressiveness.Low,
    label: "Low",
  },
  {
    value: PlanCombinationAggressiveness.Medium,
    label: "Medium",
  },
  {
    value: PlanCombinationAggressiveness.High,
    label: "High",
  },
] as const;

const isPlanCombinationAggressiveness = (
  value: unknown,
): value is PlanCombinationAggressivenessValue =>
  value === PlanCombinationAggressiveness.Low ||
  value === PlanCombinationAggressiveness.Medium ||
  value === PlanCombinationAggressiveness.High;

/**
 * Pre-start view for a plan-from-design-doc run: it renders the seed design doc
 * through the shared workflow-aware design-doc read surface, an "Edit design
 * doc" button, and a primary "Start generating" button. This is a plain
 * presentational component — not a conversation message and not a workflow
 * node — so the user reviews (and optionally edits) the seed before the run is
 * kicked off via
 * {@link PlanFromDesignDocPreStartProps.onStartGenerating}. "Start generating"
 * is disabled while the seed is loading, while the start-run is dispatching, or
 * until the CLI is connected.
 */
export const PlanFromDesignDocPreStart: React.FC<
  PlanFromDesignDocPreStartProps
> = ({
  organizationId,
  projectId,
  navigate,
  seed,
  isLoadingSeed,
  isStarting,
  onStartGenerating,
  onEditDesignDoc,
  isBridgeSelected = true,
  provider,
  model,
  reasoningEffort,
  fastMode,
  onProviderChange,
  onModelChange,
  onReasoningEffortChange,
  onFastModeChange,
  machineSelection,
  worktreeEnabled,
  worktreeBranch,
  onWorktreeEnabledChange,
  onWorktreeBranchChange,
  planCombinationAggressiveness,
  onPlanCombinationAggressivenessChange,
}) => {
  const worktreeBranchMissing = isWorktreeBranchMissing(
    worktreeEnabled,
    worktreeBranch,
  );
  const pickedMachineId = machineSelection.selectedMachineId;
  const catalogSource = pickedMachineId
    ? { organizationId, projectId, machineId: pickedMachineId }
    : null;

  return (
    <Stack spacing={2} data-testid="plan-from-design-doc-pre-start">
      {isLoadingSeed && !seed ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        seed && (
          <DesignDocReadView
            title={seed.title}
            summary={seed.summary ?? undefined}
            sections={seed.sections}
            mentionConfig={{
              organizationId,
              projectId,
              navigate,
            }}
          />
        )
      )}
      <Paper
        variant="outlined"
        sx={{ p: 2, borderRadius: 1 }}
        data-testid="plan-generation-settings-card"
      >
        <Stack spacing={2.5}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" color="text.secondary">
              Model
            </Typography>
            <RuntimeModelSelector
              catalogSource={catalogSource}
              provider={provider}
              model={model}
              reasoningEffort={reasoningEffort}
              fastMode={fastMode}
              onProviderChange={onProviderChange}
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
              onFastModeChange={onFastModeChange}
              machineSelection={machineSelection}
              disabled={isStarting}
              testIdPrefix="plan-model-selector"
            />
          </Stack>
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={worktreeEnabled}
                  onChange={(event) =>
                    onWorktreeEnabledChange(event.target.checked)
                  }
                  disabled={isStarting}
                  data-testid="plan-worktree-toggle"
                />
              }
              label={
                <Typography variant="body2">
                  Use a worktree for this plan
                </Typography>
              }
            />
            {worktreeEnabled ? (
              <TextField
                label="Branch name"
                value={worktreeBranch}
                onChange={(event) => onWorktreeBranchChange(event.target.value)}
                disabled={isStarting}
                error={worktreeBranchMissing}
                helperText={
                  worktreeBranchMissing
                    ? "Branch name is required to use a worktree."
                    : undefined
                }
                fullWidth
                size="small"
                data-testid="plan-worktree-branch"
              />
            ) : null}
          </Stack>
          <Stack spacing={1}>
            <Stack spacing={0.5}>
              <Typography variant="subtitle2" color="text.secondary">
                Step consolidation
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Controls how much the final review pass may combine drafted
                implementation steps before the plan is created. Low keeps steps
                separate except for clear duplicates, medium combines small
                adjacent steps with the same outcome, and high allows broader
                consolidation while keeping each step executable and verifiable.
              </Typography>
            </Stack>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={planCombinationAggressiveness}
              onChange={(_event, value: unknown) => {
                if (isPlanCombinationAggressiveness(value)) {
                  onPlanCombinationAggressivenessChange(value);
                }
              }}
              disabled={isStarting}
              data-testid="plan-combination-aggressiveness-selector"
              aria-label="Step consolidation"
            >
              {PLAN_COMBINATION_AGGRESSIVENESS_OPTIONS.map((option) => (
                <ToggleButton
                  key={option.value}
                  value={option.value}
                  data-testid={`plan-combination-aggressiveness-${option.value}`}
                  aria-label={`${option.label} step consolidation`}
                >
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
        </Stack>
      </Paper>
      <Stack direction="row" spacing={2} alignItems="center">
        {onEditDesignDoc && (
          <Button
            variant="outlined"
            onClick={onEditDesignDoc}
            disabled={isStarting}
            data-testid="plan-from-design-doc-edit-design-doc"
          >
            Edit design doc
          </Button>
        )}
        <Button
          variant="contained"
          onClick={onStartGenerating}
          disabled={
            isLoadingSeed ||
            isStarting ||
            !isBridgeSelected ||
            provider === null ||
            model === null ||
            worktreeBranchMissing
          }
          data-testid="plan-from-design-doc-start-generating"
          startIcon={
            isStarting ? (
              <CircularProgress size={16} color="inherit" />
            ) : undefined
          }
        >
          Start generating
        </Button>
      </Stack>
    </Stack>
  );
};
