import { describe, expect, it } from "vitest";
import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type MessageResponseDto,
  type TaskMonitorSupervisionSystemMessageData,
} from "../../../api";
import {
  buildTaskMonitorJudgmentCommand,
  getTaskMonitorJudgmentFormUiElements,
  isAwaitingTaskMonitorJudgment,
  TASK_MONITOR_JUDGMENT_FIELD_ID,
} from "../taskMonitorJudgmentForm";

const createTaskMonitorMessage = (
  data: TaskMonitorSupervisionSystemMessageData,
  awaitingResponse: boolean
): MessageResponseDto => ({
  id: "judgment-request-message",
  projectId: "project-id",
  type: MessageType.System,
  status: MessageStatus.Open,
  data,
  conversationId: "conversation-id",
  createdAt: "2026-08-06T00:00:00.000Z",
  awaitingResponse,
  responses: [],
});

describe("taskMonitorJudgmentForm", () => {
  it("creates one required textarea for an awaiting judgment request", () => {
    const message = createTaskMonitorMessage(
      {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        agentIdentity: "task-monitor-coordinator",
        outcome: "JUDGMENT_REQUESTED",
        rationale: "The evidence is inconclusive.",
        guidance: "Choose the safer product behavior.",
      },
      true
    );

    expect(isAwaitingTaskMonitorJudgment(message)).toBe(true);
    expect(getTaskMonitorJudgmentFormUiElements(message)).toEqual([
      expect.objectContaining({
        id: TASK_MONITOR_JUDGMENT_FIELD_ID,
        type: "textarea",
        required: true,
        multiline: true,
      }),
    ]);
  });

  it("builds the generated judgment command from textarea content", () => {
    expect(
      buildTaskMonitorJudgmentCommand("judgment-request-message", {
        [TASK_MONITOR_JUDGMENT_FIELD_ID]: {
          text: "  Choose the safer behavior.  ",
          files: [],
        },
      })
    ).toEqual({
      cause: "JUDGMENT_RESOLVED",
      judgment: {
        requestMessageId: "judgment-request-message",
        label: "Your judgment",
        conclusion: "Choose the safer behavior.",
      },
    });
  });

  it("does not make resolved or non-judgment supervision messages actionable", () => {
    const resolvedMessage = createTaskMonitorMessage(
      {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        agentIdentity: "task-monitor-coordinator",
        outcome: "JUDGMENT_REQUESTED",
        rationale: "The evidence is inconclusive.",
        guidance: "Choose the safer product behavior.",
      },
      false
    );
    const acceptedMessage = createTaskMonitorMessage(
      {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        agentIdentity: "task-monitor-coordinator",
        outcome: "ACCEPTED",
        rationale: "The task is complete.",
      },
      true
    );

    expect(isAwaitingTaskMonitorJudgment(resolvedMessage)).toBe(false);
    expect(getTaskMonitorJudgmentFormUiElements(resolvedMessage)).toEqual([]);
    expect(isAwaitingTaskMonitorJudgment(acceptedMessage)).toBe(false);
    expect(getTaskMonitorJudgmentFormUiElements(acceptedMessage)).toEqual([]);
  });
});
