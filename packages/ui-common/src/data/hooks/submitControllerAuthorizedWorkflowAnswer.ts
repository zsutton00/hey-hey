import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type HostActionPreparation,
  type AgentSessionsApiSubmitWorkflowAnswerRequest,
  type SubmitWorkflowAnswerRequestDto,
  type WorkflowAnswerInput,
  WorkflowAnswerInputKindEnum,
} from "../../api";
import { machinesClient, unifiedApiClient } from "../../clients/serviceClients";
import { fingerprintAgentOperation } from "../../components/AgentSession/operations/agentOperationFingerprint";
import { executeControllerAuthorizedAction } from "./useControllerAuthorizedAction";

const createWorkflowAnswerAction = (
  agentSessionId: string
): HostActionPreparation => ({
  requestId: crypto.randomUUID(),
  actionCategory: HostActionCategory.Conversation,
  actionType: HostAffectingActionType.ConversationTrigger,
  targetKind: HostActionTargetKind.AgentSession,
  targetId: agentSessionId,
});

export interface WorkflowAnswerPoster {
  submitWorkflowAnswer: (
    request: AgentSessionsApiSubmitWorkflowAnswerRequest
  ) => Promise<unknown>;
}

export interface SubmitControllerAuthorizedWorkflowAnswerInput {
  apiClient?: WorkflowAnswerPoster;
  operationId: string;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  workflowName: WorkflowAnswerInput["workflowName"];
  nodeId: string;
  parentMessageId: string;
  action: string;
  payload: Record<string, unknown>;
  evidence?: WorkflowAnswerInput["evidence"];
}

export const fingerprintWorkflowAnswer = (
  input: Omit<
    SubmitControllerAuthorizedWorkflowAnswerInput,
    "apiClient" | "evidence"
  > & { evidence?: WorkflowAnswerInput["evidence"] }
): Promise<string> => {
  const workflowInput: WorkflowAnswerInput = {
    kind: WorkflowAnswerInputKindEnum.WorkflowAnswer,
    workflowName: input.workflowName,
    nodeId: input.nodeId,
    parentMessageId: input.parentMessageId,
    action: input.action,
    payload: input.payload,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
  return fingerprintAgentOperation({
    kind: "WORKFLOW_ANSWER",
    organizationId: input.organizationId,
    projectId: input.projectId,
    operationId: input.operationId,
    agentSessionId: input.agentSessionId,
    conversationId: input.conversationId,
    input: workflowInput,
  });
};

export async function submitControllerAuthorizedWorkflowAnswer(
  input: SubmitControllerAuthorizedWorkflowAnswerInput
): Promise<void> {
  const workflowInput: WorkflowAnswerInput = {
    kind: WorkflowAnswerInputKindEnum.WorkflowAnswer,
    workflowName: input.workflowName,
    nodeId: input.nodeId,
    parentMessageId: input.parentMessageId,
    action: input.action,
    payload: input.payload,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
  const operationFingerprint = await fingerprintWorkflowAnswer(input);
  const [statusResponse, machinesResponse] = await Promise.all([
    unifiedApiClient.getConversationCliStatus({
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
    }),
    machinesClient.listMachines(),
  ]);
  const status = statusResponse.data?.data;
  if (!status?.selectedMachineId) {
    throw new Error("The conversation does not have a selected machine.");
  }
  const machine = machinesResponse.data?.data?.machines.find(
    (candidate) => candidate.machineId === status.selectedMachineId
  );
  if (!machine) throw new Error("The selected machine is no longer available.");

  const result = await executeControllerAuthorizedAction({
    organizationId: input.organizationId,
    projectId: input.projectId,
    machine,
    action: createWorkflowAnswerAction(input.agentSessionId),
    submit: ({ authorization }) => {
      const request: SubmitWorkflowAnswerRequestDto = {
        operationId: input.operationId,
        operationFingerprint,
        agentSessionId: input.agentSessionId,
        conversationId: input.conversationId,
        authorization,
        input: workflowInput,
      };
      return (input.apiClient ?? unifiedApiClient).submitWorkflowAnswer({
        organizationId: input.organizationId,
        projectId: input.projectId,
        agentSessionId: input.agentSessionId,
        submitWorkflowAnswerRequestDto: request,
      });
    },
  });
  if (result.outcome === "DENIED") {
    throw new Error(`Controller authorization denied: ${result.reason}`);
  }
}
