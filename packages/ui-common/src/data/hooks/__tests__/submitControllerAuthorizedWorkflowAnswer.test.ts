import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MachineExecutionReadinessState,
  WorkflowAnswerInputKindEnum,
  WorkflowName,
  type MachineDto,
} from "../../../api";
import {
  machinesClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import {
  fingerprintWorkflowAnswer,
  submitControllerAuthorizedWorkflowAnswer,
  type WorkflowAnswerPoster,
} from "../submitControllerAuthorizedWorkflowAnswer";

const executeAuthorizedAction = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  machinesClient: { listMachines: vi.fn() },
  unifiedApiClient: { getConversationCliStatus: vi.fn() },
}));
vi.mock("../useControllerAuthorizedAction", () => ({
  executeControllerAuthorizedAction: executeAuthorizedAction,
}));

const machine: MachineDto = {
  machineId: "machine-1",
  name: "Studio Mac",
  active: true,
  authorizationProtocolVersion: "V2",
  executionReadiness: MachineExecutionReadinessState.Ready,
};

describe("submitControllerAuthorizedWorkflowAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(unifiedApiClient.getConversationCliStatus).mockResolvedValue({
      data: {
        data: {
          connected: true,
          selectedMachineId: machine.machineId,
          authorizationProtocolVersion: machine.authorizationProtocolVersion,
          executionReadiness: MachineExecutionReadinessState.Ready,
        },
      },
    });
    vi.mocked(machinesClient.listMachines).mockResolvedValue({
      data: { data: { machines: [machine] } },
    });
    executeAuthorizedAction.mockImplementation(async (variables) => ({
      outcome: "ADMITTED",
      data: await variables.submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("submits the generated workflow-answer contract without posting a message command", async () => {
    const submitWorkflowAnswer = vi.fn().mockResolvedValue(undefined);
    const apiClient: WorkflowAnswerPoster = { submitWorkflowAnswer };
    const input = {
      apiClient,
      operationId: "operation-1",
      organizationId: "organization-1",
      projectId: "project-1",
      agentSessionId: "agent-session-1",
      conversationId: "conversation-1",
      workflowName: WorkflowName.FeatureSync,
      nodeId: "review-step",
      parentMessageId: "question-message-1",
      action: "APPROVED",
      payload: { decision: "approve" },
    } as const;

    await submitControllerAuthorizedWorkflowAnswer(input);

    const request = submitWorkflowAnswer.mock.calls[0]?.[0];
    expect(request.submitWorkflowAnswerRequestDto.input).toEqual({
      kind: WorkflowAnswerInputKindEnum.WorkflowAnswer,
      workflowName: WorkflowName.FeatureSync,
      nodeId: "review-step",
      parentMessageId: "question-message-1",
      action: "APPROVED",
      payload: { decision: "approve" },
    });
    expect(request.submitWorkflowAnswerRequestDto.operationFingerprint).toBe(
      await fingerprintWorkflowAnswer(input)
    );
  });
});
