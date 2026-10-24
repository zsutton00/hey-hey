import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  MachineExecutionReadinessState,
  type HostAffectingActionType as HostAffectingActionTypeValue,
  type SubmitTaskMonitorCommandRequestDto,
  type SubmitTaskMonitorCommandResponseDto,
  type SubmitTaskMonitorAuthorityIncreasingCommandRequestDto,
  type SubmitTaskMonitorAuthorityNeutralCommandRequestDto,
  type SubmitTaskMonitorAuthorityReductionCommandRequestDto,
  type TaskMonitorExternalCommand,
} from "../../api";
import { tasksClient } from "../../clients/serviceClients";
import { useMutation, type MutationOptions } from "../core/useMutation";
import { useUserPairedMachines } from "./useUserPairedMachines";
import { useControllerAuthorizedAction } from "./useControllerAuthorizedAction";

type BrowserTaskMonitorAuthorityIncreasingCommandRequest = Omit<
  SubmitTaskMonitorAuthorityIncreasingCommandRequestDto,
  "authorization"
>;
type BrowserTaskMonitorCommandRequest =
  | BrowserTaskMonitorAuthorityIncreasingCommandRequest
  | SubmitTaskMonitorAuthorityNeutralCommandRequestDto
  | SubmitTaskMonitorAuthorityReductionCommandRequestDto;

export interface SubmitTaskMonitorCommandVariables {
  organizationId: string;
  projectId: string;
  monitorId: string;
  request: BrowserTaskMonitorCommandRequest;
}

export type UseSubmitTaskMonitorCommandOptions =
  MutationOptions<SubmitTaskMonitorCommandResponseDto>;

const AUTHORITY_INCREASING_ACTIONS = {
  START: HostAffectingActionType.TaskMonitorStart,
  RESUME: HostAffectingActionType.TaskMonitorResume,
  JUDGMENT_RESOLVED: HostAffectingActionType.TaskMonitorJudgmentResolved,
  CONTINUE: HostAffectingActionType.TaskMonitorContinue,
  COMPLETE: HostAffectingActionType.TaskMonitorComplete,
} as const satisfies Partial<
  Record<TaskMonitorExternalCommand["cause"], HostAffectingActionTypeValue>
>;

const getAuthorityIncreasingAction = (
  cause: TaskMonitorExternalCommand["cause"],
): HostAffectingActionTypeValue | null =>
  cause in AUTHORITY_INCREASING_ACTIONS
    ? AUTHORITY_INCREASING_ACTIONS[
        cause as keyof typeof AUTHORITY_INCREASING_ACTIONS
      ]
    : null;

const isAuthorityIncreasingRequest = (
  request: BrowserTaskMonitorCommandRequest,
): request is BrowserTaskMonitorAuthorityIncreasingCommandRequest =>
  request.command.cause in AUTHORITY_INCREASING_ACTIONS;

export function useSubmitTaskMonitorCommand(
  options: UseSubmitTaskMonitorCommandOptions = {},
) {
  const { machines } = useUserPairedMachines();
  const authorization =
    useControllerAuthorizedAction<SubmitTaskMonitorCommandResponseDto>();

  const submitRequest = async (
    organizationId: string,
    projectId: string,
    monitorId: string,
    request: SubmitTaskMonitorCommandRequestDto,
  ): Promise<SubmitTaskMonitorCommandResponseDto> => {
    const response = await tasksClient.submitTaskMonitorCommand({
      organizationId,
      projectId,
      monitorId,
      submitTaskMonitorCommandRequestDto: request,
    });
    const payload = response.data?.data;
    if (!payload) {
      throw new Error(
        "The platform did not return a monitor-command acknowledgement.",
      );
    }
    return payload;
  };

  const mutationFn = async ({
    organizationId,
    projectId,
    monitorId,
    request,
  }: SubmitTaskMonitorCommandVariables): Promise<SubmitTaskMonitorCommandResponseDto> => {
    if (!isAuthorityIncreasingRequest(request)) {
      return submitRequest(organizationId, projectId, monitorId, request);
    }
    const actionType = getAuthorityIncreasingAction(request.command.cause);
    if (!actionType) {
      throw new Error("The Task Monitor command is not authorization-capable.");
    }
    if (!request.machineId) {
      throw new Error(
        "A controller-ready selected machine is required for this Task Monitor command.",
      );
    }
    const machine = machines.find(
      (candidate) => candidate.machineId === request.machineId,
    );
    if (
      !machine ||
      machine.executionReadiness !== MachineExecutionReadinessState.Ready
    ) {
      throw new Error("The selected machine is not controller-ready.");
    }
    const result = await authorization.mutate({
      organizationId,
      projectId,
      machine,
      action: {
        requestId: request.requestId,
        actionCategory: HostActionCategory.TaskMonitor,
        actionType,
        targetKind: HostActionTargetKind.TaskMonitor,
        targetId: monitorId,
        inputs: { kind: "TASK_MONITOR", command: request.command },
      },
      submit: ({ authorization }) =>
        submitRequest(organizationId, projectId, monitorId, {
          ...request,
          authorization,
        }),
    });
    if (result.outcome === "DENIED") {
      throw new Error(`Controller authorization denied: ${result.reason}`);
    }
    return result.data;
  };

  return useMutation(mutationFn, options);
}
