import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtendedUIFieldType,
  MessageStatus,
  MessageType,
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  SystemMessageDataTypeEnum,
  type MessageResponseDto,
  type TaskMonitorSupervisionSystemMessageData,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import { useTaskMonitorConversationFormResolver } from "../useTaskMonitorConversationFormResolver";
import { TASK_MONITOR_JUDGMENT_FIELD_ID } from "../taskMonitorJudgmentForm";

const submitMocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock("../../../data/hooks", () => ({
  useSubmitTaskMonitorCommand: () => ({
    mutate: submitMocks.mutate,
    isPending: false,
  }),
}));

const createAwaitingJudgmentMessage = (
  overrides: Partial<MessageResponseDto> = {}
): ConversationMessage => ({
  message: {
    id: "judgment-request-message",
    projectId: "project-id",
    type: MessageType.System,
    status: MessageStatus.Open,
    data: {
      type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
      agentIdentity: "task-monitor-coordinator",
      outcome: "JUDGMENT_REQUESTED",
      rationale: "The evidence is inconclusive.",
      guidance: "Choose the safer product behavior.",
    } satisfies TaskMonitorSupervisionSystemMessageData,
    conversationId: "conversation-id",
    createdAt: "2026-08-06T00:00:00.000Z",
    awaitingResponse: true,
    responses: [],
    ...overrides,
  },
  state: "awaiting_response",
  canEdit: true,
  data: {},
});

describe("useTaskMonitorConversationFormResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitMocks.mutate.mockResolvedValue({
      commandId: "command-id",
      status: SubmitTaskMonitorCommandResponseDtoStatusEnum.Admitted,
    });
  });

  it("returns no form for a message outside its owner-owned judgment surface", () => {
    const { result } = renderHook(() =>
      useTaskMonitorConversationFormResolver({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        selectedMachineId: "machine-1",
      })
    );

    expect(
      result.current(createAwaitingJudgmentMessage({ awaitingResponse: false }))
    ).toBeNull();
  });

  it("keeps the judgment form enabled from owner state when generic readiness is irrelevant", async () => {
    const message = createAwaitingJudgmentMessage();
    const { result } = renderHook(() =>
      useTaskMonitorConversationFormResolver({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: " monitor-1 ",
        selectedMachineId: "machine-1",
      })
    );

    const resolution = result.current(message);
    if (!resolution) {
      throw new Error("Expected an owner-resolved judgment form.");
    }

    expect(resolution.responseDeclarations).toEqual([{
      ownership: "exclusive",
      currentFieldId: TASK_MONITOR_JUDGMENT_FIELD_ID,
      submissionKind: "owner-command",
    }]);
    expect(resolution.disabled).toBe(false);
    expect(resolution.isSubmitted).toBe(false);
    expect(resolution.composerResetMode).toBe("clearOnSuccess");
    expect(resolution.uiElements).toEqual([
      expect.objectContaining({
        id: TASK_MONITOR_JUDGMENT_FIELD_ID,
        type: ExtendedUIFieldType.Textarea,
      }),
    ]);

    await act(async () => {
      await resolution.submit({
        [TASK_MONITOR_JUDGMENT_FIELD_ID]: "  Use the safer behavior.  ",
      });
    });

    expect(submitMocks.mutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "monitor-1",
      request: {
        requestId: "judgment-request-message",
        machineId: "machine-1",
        command: {
          cause: "JUDGMENT_RESOLVED",
          judgment: {
            requestMessageId: "judgment-request-message",
            label: "Your judgment",
            conclusion: "Use the safer behavior.",
          },
        },
      },
    });
  });

  it("marks the form unavailable when its command target is incomplete", () => {
    const { result } = renderHook(() =>
      useTaskMonitorConversationFormResolver({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: " ",
        selectedMachineId: null,
      })
    );

    const resolution = result.current(createAwaitingJudgmentMessage());
    expect(resolution?.disabled).toBe(true);
  });

  it("surfaces a rejected command to the generic form owner", async () => {
    submitMocks.mutate.mockResolvedValueOnce({
      commandId: "command-id",
      status: SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected,
      message: "The judgment is no longer current.",
    });
    const { result } = renderHook(() =>
      useTaskMonitorConversationFormResolver({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        selectedMachineId: "machine-1",
      })
    );
    const resolution = result.current(createAwaitingJudgmentMessage());
    if (!resolution) {
      throw new Error("Expected an owner-resolved judgment form.");
    }

    await act(async () => {
      await expect(
        resolution.submit({
          [TASK_MONITOR_JUDGMENT_FIELD_ID]: "Choose the safer behavior.",
        })
      ).rejects.toThrow("The judgment is no longer current.");
    });
  });
});
