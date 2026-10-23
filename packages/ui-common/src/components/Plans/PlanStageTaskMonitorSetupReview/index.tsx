import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  TaskMonitorExecutionDefinition,
  TaskMonitorExecutionPlanNode,
  TaskMonitorExecutionNodeLaunchConfiguration,
} from "../../../api";
import { EntityType as EntityTypeValue } from "../../../api";
import { defaultClient } from "../../../clients";
import { useMentionEntitySearch } from "../../../data/hooks/useMentionEntitySearch";
import {
  useLocalDraftRecovery,
  writeLocalDraftRecoveryValue,
} from "../../../hooks/useLocalDraftRecovery";
import type { SurfaceSelection } from "../../AgentSession/surfaceSelectionMemory";
import { supportsFastMode } from "../../AgentSession/capabilityCatalog";
import type { RuntimeModelCatalogSource } from "../../AgentSession/useRuntimeModelCatalog";
import {
  TASK_MONITOR_SETUP_SURFACE_ID,
  writeSurfaceSelection,
} from "../../AgentSession/surfaceSelectionMemory";
import { PlanStageTaskMonitorSetupReviewView } from "../PlanStageTaskMonitorSetupReviewView";
import type { PlanStageTaskMonitorTaskSelection } from "../PlanStageTaskMonitorExecutionVisualization";
import { buildPlanStageTaskMonitorUserMessageStorageKey } from "../planStageTaskMonitorMessage";
import { syncTaskServiceLinks } from "../planStageTaskServiceLinks";
import type { PlanStageTaskMonitorSetupDraft } from "../planStageTaskMonitorSetup";

export interface PlanStageTaskMonitorSetupReviewProps {
  setup: PlanStageTaskMonitorSetupDraft;
  /** The machine whose CLI offers the model choices; null until one is picked. */
  catalogSource: RuntimeModelCatalogSource | null;
  isRefreshingTaskServices: boolean;
  onRefreshTaskServices: () => Promise<unknown>;
  onConfirm: (
    reviewedDefinition: TaskMonitorExecutionDefinition,
    userMessage: string,
  ) => void;
}

type TaskMonitorSurfaceSelection = Omit<SurfaceSelection, "reasoningEffort"> & {
  reasoningEffort: TaskMonitorExecutionNodeLaunchConfiguration["reasoningEffort"];
};

const sourceIdentityFor = (setup: PlanStageTaskMonitorSetupDraft): string =>
  [
    setup.provenance.organizationId,
    setup.provenance.projectId,
    setup.provenance.planId,
    setup.provenance.stageId,
  ].join(":");

const surfaceSelectionFor = (
  configuration: TaskMonitorExecutionNodeLaunchConfiguration,
): TaskMonitorSurfaceSelection => ({
  provider: configuration.provider,
  model: configuration.model,
  reasoningEffort: configuration.reasoningEffort,
  ...(supportsFastMode(configuration.provider, configuration.model)
    ? { fastMode: configuration.fastMode ?? false }
    : {}),
});

const normalizeNodeLaunchConfiguration = (
  configuration: TaskMonitorExecutionNodeLaunchConfiguration,
): TaskMonitorExecutionNodeLaunchConfiguration => {
  const { fastMode: _staleFastMode, ...base } = configuration;
  return supportsFastMode(base.provider, base.model)
    ? { ...base, fastMode: configuration.fastMode ?? false }
    : base;
};

const withWorktreeBranch = (
  definition: TaskMonitorExecutionDefinition,
  branch: string | null,
): TaskMonitorExecutionDefinition => {
  if (branch === null) {
    const { worktree: _worktree, ...withoutWorktree } = definition.launchPolicy;
    return { ...definition, launchPolicy: withoutWorktree };
  }
  return {
    ...definition,
    launchPolicy: {
      ...definition.launchPolicy,
      worktree: { enabled: true, branch },
    },
  };
};

const definitionForTaskSelection = (
  definition: TaskMonitorExecutionDefinition,
  selectedTaskIds: ReadonlySet<TaskMonitorExecutionPlanNode["taskId"]>,
): TaskMonitorExecutionDefinition => {
  const selectedNodes = definition.executionPlan.filter((node) =>
    selectedTaskIds.has(node.taskId),
  );
  const retainedTaskIds = new Set(selectedNodes.map((node) => node.taskId));

  return {
    ...definition,
    executionPlan: selectedNodes.map((node) => ({
      ...node,
      dependsOnTaskIds: node.dependsOnTaskIds.filter((taskId) =>
        retainedTaskIds.has(taskId),
      ),
    })),
  };
};

export const PlanStageTaskMonitorSetupReview = ({
  setup,
  catalogSource,
  isRefreshingTaskServices,
  onRefreshTaskServices,
  onConfirm,
}: PlanStageTaskMonitorSetupReviewProps) => {
  const navigate = useNavigate();
  const sourceIdentity = sourceIdentityFor(setup);
  const planWorktreeBranch = setup.provenance.planWorktreeBranch;
  const previousSourceIdentity = useRef(sourceIdentity);
  const [userMessage, setUserMessage] = useState("");
  const [reviewedDefinition, setReviewedDefinition] =
    useState<TaskMonitorExecutionDefinition>(setup.definition);
  const [selectedTaskIds, setSelectedTaskIds] = useState<
    ReadonlySet<TaskMonitorExecutionPlanNode["taskId"]>
  >(() => new Set(setup.definition.executionPlan.map((node) => node.taskId)));
  const [hasEditedUserMessage, setHasEditedUserMessage] = useState(false);
  const [updatingTaskServiceIds, setUpdatingTaskServiceIds] = useState<
    string[]
  >([]);
  const [serviceUpdateError, setServiceUpdateError] = useState<string | null>(
    null,
  );
  const { searchEntities } = useMentionEntitySearch(
    setup.provenance.organizationId,
    setup.provenance.projectId,
    null,
  );
  const userMessageStorageKey = buildPlanStageTaskMonitorUserMessageStorageKey(
    setup.provenance,
  );
  const restoreUserMessage = useCallback((restored: string) => {
    setUserMessage(restored);
    setHasEditedUserMessage(false);
  }, []);
  const updateNodeLaunchConfiguration = useCallback(
    (
      taskId: string,
      update: (
        current: TaskMonitorExecutionNodeLaunchConfiguration,
      ) => TaskMonitorExecutionNodeLaunchConfiguration,
    ) => {
      setReviewedDefinition((current) => ({
        ...current,
        executionPlan: current.executionPlan.map((node) =>
          node.taskId === taskId
            ? { ...node, launchConfiguration: update(node.launchConfiguration) }
            : node,
        ),
      }));
    },
    [],
  );
  const updateNodeRuntimeSelection = useCallback(
    (
      taskId: string,
      update: (
        current: TaskMonitorSurfaceSelection,
      ) => TaskMonitorSurfaceSelection,
    ) => {
      setReviewedDefinition((current) => ({
        ...current,
        executionPlan: current.executionPlan.map((node) => {
          if (node.taskId !== taskId) return node;
          const next = update(surfaceSelectionFor(node.launchConfiguration));
          writeSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID, next);
          return {
            ...node,
            launchConfiguration: normalizeNodeLaunchConfiguration({
              ...node.launchConfiguration,
              ...next,
            }),
          };
        }),
      }));
    },
    [],
  );

  useEffect(() => {
    if (previousSourceIdentity.current === sourceIdentity) return;
    previousSourceIdentity.current = sourceIdentity;
    setUserMessage("");
    setHasEditedUserMessage(false);
    setReviewedDefinition(setup.definition);
    setSelectedTaskIds(
      new Set(setup.definition.executionPlan.map((node) => node.taskId)),
    );
  }, [setup.definition, sourceIdentity]);

  const handleToggleTask = useCallback((taskId: string): void => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  useLocalDraftRecovery({
    storageKey: userMessageStorageKey,
    value: userMessage,
    isDirty: hasEditedUserMessage,
    isSaving: false,
    onRestore: restoreUserMessage,
  });

  const handleChangeTaskServices = useCallback(
    async (taskId: string, nextServiceIds: string[]): Promise<void> => {
      const task = setup.executableTasks.find(
        (candidate) => candidate.taskId === taskId,
      );
      if (!task || updatingTaskServiceIds.includes(taskId)) return;

      if (
        task.serviceIds.length === nextServiceIds.length &&
        task.serviceIds.every((serviceId) => nextServiceIds.includes(serviceId))
      )
        return;

      setServiceUpdateError(null);
      setUpdatingTaskServiceIds((current) => [...current, taskId]);
      try {
        await syncTaskServiceLinks({
          client: defaultClient,
          organizationId: setup.provenance.organizationId,
          taskId,
          currentServiceIds: task.serviceIds,
          nextServiceIds,
        });
      } catch (error) {
        setServiceUpdateError(
          error instanceof Error
            ? error.message
            : "Unable to update the task's Services.",
        );
      } finally {
        try {
          await onRefreshTaskServices();
        } catch (error) {
          setServiceUpdateError(
            error instanceof Error
              ? error.message
              : "Unable to refresh the task's Services.",
          );
        }
        setUpdatingTaskServiceIds((current) =>
          current.filter((candidate) => candidate !== taskId),
        );
      }
    },
    [onRefreshTaskServices, setup, updatingTaskServiceIds],
  );
  const selectedDefinition = definitionForTaskSelection(
    reviewedDefinition,
    selectedTaskIds,
  );
  const definitionToConfirm = withWorktreeBranch(
    selectedDefinition,
    planWorktreeBranch ??
      selectedDefinition.launchPolicy.worktree?.branch ??
      null,
  );

  return (
    <PlanStageTaskMonitorSetupReviewView
      catalogSource={catalogSource}
      definition={reviewedDefinition}
      executableTasks={setup.executableTasks}
      taskSelection={
        {
          selectedTaskIds,
          onToggleTask: handleToggleTask,
        } satisfies PlanStageTaskMonitorTaskSelection
      }
      provenance={setup.provenance}
      userMessage={userMessage}
      userMessageMentionConfig={{
        organizationId: setup.provenance.organizationId,
        projectId: setup.provenance.projectId,
        navigate,
      }}
      userMessageEntitySlashConfig={{
        organizationId: setup.provenance.organizationId,
        projectId: setup.provenance.projectId,
        focalEntity: {
          kind: "entity",
          entityType: EntityTypeValue.Task,
          entityId: setup.provenance.stageId,
        },
        onSearchEntities: searchEntities,
      }}
      onChangeUserMessage={(nextUserMessage) => {
        writeLocalDraftRecoveryValue(userMessageStorageKey, nextUserMessage);
        setUserMessage(nextUserMessage);
        setHasEditedUserMessage(true);
      }}
      onChangeMethod={(taskId, method) => {
        updateNodeLaunchConfiguration(taskId, (current) => ({
          ...current,
          method,
        }));
      }}
      onChangeProvider={(taskId, provider) => {
        updateNodeRuntimeSelection(taskId, (current) => ({
          ...current,
          provider,
        }));
      }}
      onChangeModel={(taskId, model) => {
        updateNodeRuntimeSelection(taskId, (current) => ({
          ...current,
          model,
        }));
      }}
      onChangeReasoningEffort={(taskId, reasoningEffort) => {
        if (!reasoningEffort) return;
        updateNodeRuntimeSelection(taskId, (current) => ({
          ...current,
          reasoningEffort,
        }));
      }}
      onChangeFastMode={(taskId, fastMode) => {
        updateNodeRuntimeSelection(taskId, (current) => ({
          ...current,
          fastMode,
        }));
      }}
      onChangeReviewMode={(mode) => {
        setReviewedDefinition((current) => ({
          ...current,
          launchPolicy: {
            ...current.launchPolicy,
            terminalSupervision: {
              ...current.launchPolicy.terminalSupervision,
              mode,
            },
          },
        }));
      }}
      worktreeBranch={
        planWorktreeBranch ??
        reviewedDefinition.launchPolicy.worktree?.branch ??
        null
      }
      worktreeLocked={planWorktreeBranch !== null}
      onChangeWorktreeBranch={(nextBranch) => {
        if (planWorktreeBranch !== null) return;
        setReviewedDefinition((current) =>
          withWorktreeBranch(current, nextBranch),
        );
      }}
      isRefreshingTaskServices={isRefreshingTaskServices}
      updatingTaskServiceIds={updatingTaskServiceIds}
      serviceUpdateError={serviceUpdateError}
      onChangeTaskServices={(taskId, serviceIds) => {
        void handleChangeTaskServices(taskId, serviceIds);
      }}
      onRefreshTaskServices={() => {
        void onRefreshTaskServices();
      }}
      onConfirm={() => onConfirm(definitionToConfirm, userMessage.trim())}
    />
  );
};
