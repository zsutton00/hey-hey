import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  TargetEntityType,
  WorkStatus,
} from "../../api";
import { usePathService } from "../../contexts";
import {
  useCanonicalPlanAggregate,
  useWorkItems,
  type CanonicalPlanAggregateStage,
  type PlanStageStandardTask,
} from "../../data";
import { CapsuleAction } from "../ActionsCapsule";
import { InteractionComponent } from "../InteractionComponent";
import { ExecutionGraphSurface } from "../shared/ExecutionGraph";
import { buildCanonicalPlanExecutionGraphViewModel } from "./buildCanonicalPlanExecutionGraphViewModel";
import { PlanAutomationChoiceDialog } from "./PlanAutomationChoiceDialog";
import { PlanCompletionAction } from "./PlanCompletionAction";
import { isRelatedNonTerminalTaskMonitor } from "./planAutomationEligibility";

interface PlanViewerBaseProps {
  organizationId: string;
  projectId: string;
  planId: string;
  disablePreview?: boolean;
  readOnly?: boolean;
  selectedStageId?: string | null;
  onStageChange?: (
    stageId: string,
    options?: { replace?: boolean }
  ) => void;
  onNavigateToTask?: (task: PlanStageStandardTask, stageId: string) => void;
}

type PlanViewerAutomationProps =
  | {
      onAutomateStage: (stageId: string) => void;
      onViewAutomation: () => void;
    }
  | {
      onAutomateStage?: undefined;
      onViewAutomation?: undefined;
    };

export type PlanViewerProps = PlanViewerBaseProps & PlanViewerAutomationProps;

const isComplete = (stage: CanonicalPlanAggregateStage): boolean =>
  stage.stage.status === WorkStatus.Completed ||
  (stage.orderedTasks.length > 0 &&
    stage.orderedTasks.every((task) => task.status === WorkStatus.Completed));

const isSelectableStage = (stage: CanonicalPlanAggregateStage): boolean =>
  stage.stage.status !== WorkStatus.Archived;

const findDefaultStage = (
  stages: readonly CanonicalPlanAggregateStage[]
): CanonicalPlanAggregateStage | undefined =>
  stages.find((stage) => isSelectableStage(stage) && !isComplete(stage)) ??
  stages.find(isSelectableStage);

export const PlanViewer: React.FC<PlanViewerProps> = ({
  organizationId,
  projectId,
  planId,
  disablePreview,
  readOnly,
  selectedStageId,
  onStageChange,
  onNavigateToTask,
  onAutomateStage,
  onViewAutomation,
}) => {
  const navigate = useNavigate();
  const pathService = usePathService();
  const planResult = useCanonicalPlanAggregate(
    organizationId,
    projectId,
    planId
  );
  const [internalStageId, setInternalStageId] = useState<string | null>(null);
  const [automationChoice, setAutomationChoice] = useState<{
    stageId: string;
    relatedMonitorCount: number;
  } | null>(null);
  const [isResolvingAutomation, setIsResolvingAutomation] = useState(false);
  const [automationLaunchError, setAutomationLaunchError] = useState<
    string | null
  >(null);
  const defaultStageResolutionRef = useRef<string | null>(null);
  const aggregate = planResult.aggregate;
  const plan = aggregate?.plan;
  const stages = aggregate?.stages.filter(isSelectableStage) ?? [];
  const isControlled = selectedStageId !== undefined;
  const resolvedStageId = isControlled ? selectedStageId : internalStageId;
  const selectedStage = stages.find(
    ({ stage }) => stage.id === resolvedStageId
  );
  const defaultStage = findDefaultStage(stages);
  const defaultStageId = defaultStage?.stage.id;
  const graphViewModel = selectedStage
    ? buildCanonicalPlanExecutionGraphViewModel(selectedStage)
    : { nodes: [], dependencyEdges: [] };

  const setStageId = useCallback(
    (stageId: string) => {
      if (onStageChange) onStageChange(stageId);
      else setInternalStageId(stageId);
    },
    [onStageChange]
  );

  useEffect(() => {
    if (!isControlled && !resolvedStageId && defaultStageId) {
      if (defaultStageResolutionRef.current === defaultStageId) return;
      defaultStageResolutionRef.current = defaultStageId;
      setInternalStageId(defaultStageId);
      onStageChange?.(defaultStageId, { replace: true });
    }
  }, [defaultStageId, isControlled, onStageChange, resolvedStageId]);

  const { refetch: refetchPlanAutomation } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      enabled:
        plan?.status === WorkStatus.Active &&
        Boolean(onAutomateStage && onViewAutomation),
      taskType: "TASK_MONITOR",
      relatedEntityId: planId,
      relatedEntityType: AgentEdgeEndpointEntityType.Task,
      edgeTypes: [AgentEdgeType.RelatedTo],
    }
  );

  const canAutomateStage =
    plan?.status === WorkStatus.Active &&
    selectedStage !== undefined &&
    selectedStage.stage.status !== WorkStatus.Refining &&
    selectedStage.stage.status !== WorkStatus.Completed &&
    selectedStage.stage.status !== WorkStatus.Archived &&
    Boolean(onAutomateStage && onViewAutomation);

  const handleAutomateStage = useCallback(() => {
    if (
      !canAutomateStage ||
      !selectedStage ||
      !onAutomateStage ||
      isResolvingAutomation
    ) {
      return;
    }
    const stageId = selectedStage.stage.id;
    setIsResolvingAutomation(true);
    setAutomationLaunchError(null);
    void refetchPlanAutomation()
      .then((refreshedMonitors) => {
        const relatedMonitors = (refreshedMonitors ?? []).filter(
          isRelatedNonTerminalTaskMonitor
        );
        if (relatedMonitors.length === 0) onAutomateStage(stageId);
        else {
          setAutomationChoice({
            stageId,
            relatedMonitorCount: relatedMonitors.length,
          });
        }
      })
      .catch((error: unknown) => {
        setAutomationLaunchError(
          error instanceof Error
            ? error.message
            : "Unable to check this Plan’s existing automation."
        );
      })
      .finally(() => setIsResolvingAutomation(false));
  }, [
    canAutomateStage,
    isResolvingAutomation,
    onAutomateStage,
    refetchPlanAutomation,
    selectedStage,
  ]);

  const handleTaskClick = useCallback(
    (task: PlanStageStandardTask) => {
      if (!selectedStage) return;
      if (onNavigateToTask) {
        onNavigateToTask(task, selectedStage.stage.id);
        return;
      }
      navigate(pathService.planTask({ projectId, planId, taskId: task.id }));
    },
    [navigate, onNavigateToTask, pathService, planId, projectId, selectedStage]
  );

  const handleGraphNodeClick = useCallback(
    (taskId: string) => {
      const task = selectedStage?.orderedTasks.find(
        (candidate) => candidate.id === taskId
      );
      if (task) handleTaskClick(task);
    },
    [handleTaskClick, selectedStage]
  );

  if (planResult.status === "loading") {
    return (
      <Stack
        data-testid="plan-viewer-loading"
        alignItems="center"
        sx={{ py: 6 }}
      >
        <CircularProgress />
      </Stack>
    );
  }
  if (planResult.status === "error") {
    return (
      <Alert data-testid="plan-viewer-error" severity="error">
        {planResult.error.message}
      </Alert>
    );
  }
  if (stages.length === 0) {
    return (
      <Paper data-testid="plan-viewer-empty" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" color="text.secondary">
          No Stages are defined for this Plan.
        </Typography>
      </Paper>
    );
  }

  const selectedIndex = selectedStage
    ? stages.findIndex(({ stage }) => stage.id === selectedStage.stage.id)
    : 0;

  return (
    <>
      <InteractionComponent
        entityId={planResult.aggregate.plan.id}
        entityType={TargetEntityType.Task}
        entitySubtype={planResult.aggregate.plan.type}
        entityTitle={planResult.aggregate.plan.name}
        organizationId={organizationId}
        projectId={projectId}
        hasProposalSupport
        draggable={false}
        disablePreview={disablePreview}
      >
        <Stack data-testid="plan-viewer" spacing={3}>
          <Stepper nonLinear activeStep={selectedIndex} alternativeLabel>
            {stages.map((aggregateStage) => {
              const completedTasks = aggregateStage.orderedTasks.filter(
                (task) => task.status === WorkStatus.Completed
              ).length;
              return (
                <Step
                  key={aggregateStage.stage.id}
                  completed={isComplete(aggregateStage)}
                >
                  <StepButton
                    data-testid="plan-viewer-stage-button"
                    data-work-item-id={aggregateStage.stage.id}
                    onClick={() => setStageId(aggregateStage.stage.id)}
                  >
                    <StepLabel>
                      <Stack component="span" spacing={0.25}>
                        <span>{aggregateStage.stage.name}</span>
                        <Typography variant="caption">
                          {completedTasks}/{aggregateStage.orderedTasks.length}{" "}
                          tasks
                        </Typography>
                      </Stack>
                    </StepLabel>
                  </StepButton>
                </Step>
              );
            })}
          </Stepper>

          {selectedStage && (
            <>
              {graphViewModel.nodes.length > 0 ? (
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Box sx={{ overflowX: "auto", overflowY: "hidden" }}>
                    <ExecutionGraphSurface
                      viewModel={graphViewModel}
                      selectedNodeId={null}
                      onNodeSelect={handleGraphNodeClick}
                      initialFocusNodeId={
                        graphViewModel.nodes.find(
                          (node) =>
                            node.state === "active" || node.state === "eligible"
                        )?.id
                      }
                      selectable={false}
                      animateCurrentTask={false}
                    />
                  </Box>
                </Paper>
              ) : (
                <Paper
                  data-testid="plan-execution-graph-empty"
                  variant="outlined"
                  sx={{ p: 4, textAlign: "center" }}
                >
                  <Typography variant="body1" color="text.secondary">
                    No implementation Tasks are defined for this Plan Stage.
                  </Typography>
                </Paper>
              )}
            </>
          )}
        </Stack>
      </InteractionComponent>

      {plan && !readOnly ? (
        <PlanCompletionAction
          organizationId={organizationId}
          projectId={projectId}
          planId={plan.id}
          planTitle={plan.name}
          planStatus={plan.status}
        />
      ) : null}

      {automationLaunchError && (
        <Alert severity="error" data-testid="plan-automation-launch-error">
          {automationLaunchError}
        </Alert>
      )}
      {canAutomateStage && (
        <CapsuleAction
          id="automate-plan-stage"
          label="Automate"
          icon={AutoAwesomeIcon}
          behavior="click"
          onClick={handleAutomateStage}
          disabled={isResolvingAutomation}
          inProgress={isResolvingAutomation}
          actionGroup="page"
          tier="page"
          order={10}
        />
      )}
      <PlanAutomationChoiceDialog
        open={automationChoice !== null}
        relatedMonitorCount={automationChoice?.relatedMonitorCount ?? 0}
        onViewExisting={() => {
          setAutomationChoice(null);
          onViewAutomation?.();
        }}
        onCreateAnother={() => {
          if (!automationChoice) return;
          const { stageId } = automationChoice;
          setAutomationChoice(null);
          onAutomateStage?.(stageId);
        }}
      />
    </>
  );
};
