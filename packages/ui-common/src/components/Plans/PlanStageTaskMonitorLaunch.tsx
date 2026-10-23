import { usePlanStageTaskMonitorSetup } from "./usePlanStageTaskMonitorSetup";
import type { PlanStageTaskMonitorLaunchViewProps } from "./PlanStageTaskMonitorLaunchView";
import { PlanStageTaskMonitorLaunchView } from "./PlanStageTaskMonitorLaunchView";
import type { UsePlanStageTaskMonitorSetupOptions } from "./usePlanStageTaskMonitorSetup";
import { PlanStageTaskMonitorSetupReview } from "./PlanStageTaskMonitorSetupReview/index";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { ModelSelectorMachineSelection } from "../AgentSession/ModelSelector";

export type PlanStageTaskMonitorLaunchProps = Omit<
  PlanStageTaskMonitorLaunchViewProps,
  "state"
> &
  UsePlanStageTaskMonitorSetupOptions;

export const PlanStageTaskMonitorLaunch = ({
  onContinue,
  onRetry,
  ...setupOptions
}: PlanStageTaskMonitorLaunchProps) => {
  const {
    state,
    catalogSource,
    machineSelection,
    isLoading,
    isRefreshingTaskServices,
    isFetched,
    refetchTaskServices,
  } = usePlanStageTaskMonitorSetup(setupOptions);

  const machinePicker = (
    <ModelSelectorMachineSelection
      testIdPrefix="plan-stage-task-monitor"
      machineSelection={machineSelection}
    />
  );

  if (state.status === "ready") {
    return (
      <DataStateBoundary loading={isLoading} fetched={isFetched}>
        {machinePicker}
        <PlanStageTaskMonitorSetupReview
          setup={state.draft}
          catalogSource={catalogSource}
          isRefreshingTaskServices={isRefreshingTaskServices}
          onRefreshTaskServices={refetchTaskServices}
          onConfirm={(reviewedDefinition, userMessage) => {
            onContinue({
              ...state.draft,
              definition: reviewedDefinition,
              ...(userMessage ? { supplementalMessage: userMessage } : {}),
            });
          }}
        />
      </DataStateBoundary>
    );
  }

  return (
    <DataStateBoundary loading={isLoading} fetched={isFetched}>
      {machinePicker}
      <PlanStageTaskMonitorLaunchView
        state={state}
        onContinue={onContinue}
        onRetry={onRetry}
      />
    </DataStateBoundary>
  );
};
