import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  MessageType,
  SecondaryActionHandler,
  WorkflowName,
  type MessageResponseDto,
} from "../../../api";
import { LocalPromptType } from "../../../api";
import {
  AUTO_ADVANCE_MESSAGE_TEXT,
  useAutoAdvanceFeatureSyncIterate,
} from "../useAutoAdvanceFeatureSyncIterate";

let postMessage: ReturnType<typeof vi.fn>;
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: {
      startSession: vi.fn(),
      submitMessage: (input: unknown) => postMessage(input),
    },
    unavailable: null,
  }),
}));

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "proj-1";
const CONVERSATION_ID = "conv-1";
const TRIGGERING_MESSAGE_ID = "msg-1";
const RUN_ID = "run-1";
const ELEMENT_ID = "field-1";
// Distinct from TRIGGERING_MESSAGE_ID so the "parents off the closing message"
// assertions can't pass by coincidence with the generic-message tests above.
const CLOSING_MESSAGE_ID = "completion-msg-1";

const buildMessage = (
  uiElements: Array<{ id: string; type: string; [key: string]: unknown }> = [],
  secondaryActions?: Array<{
    handler: string;
    fieldId?: string;
    [key: string]: unknown;
  }>,
  promptHandler?: string
): MessageResponseDto =>
  ({
    id: TRIGGERING_MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    type: "SYSTEM",
    data: {
      type: "QUESTIONS",
      uiElements,
      ...(secondaryActions ? { secondaryActions } : {}),
      ...(promptHandler ? { promptHandler } : {}),
    },
  } as unknown as MessageResponseDto);

/**
 * Models the message the append-only write path hands the auto-advance: the
 * turn's *closing* message — the completion stamped `actionHint: task_complete`
 * that the grouping pass re-homes the turn's proposals (and the agent's
 * structured form) onto. No pre-created anchor is involved; the form and the
 * advance trigger's parent both come from this one closing message.
 */
const buildClosingMessage = (
  uiElements: Array<{ id: string; type: string; [key: string]: unknown }> = [],
  secondaryActions?: Array<{
    handler: string;
    fieldId?: string;
    [key: string]: unknown;
  }>,
  promptHandler?: string
): MessageResponseDto =>
  ({
    id: CLOSING_MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    type: "SYSTEM",
    data: {
      type: "QUESTIONS",
      actionHint: "task_complete",
      uiElements,
      ...(secondaryActions ? { secondaryActions } : {}),
      ...(promptHandler ? { promptHandler } : {}),
    },
  } as unknown as MessageResponseDto);

describe("useAutoAdvanceFeatureSyncIterate", () => {
  beforeEach(() => {
    postMessage = vi.fn().mockResolvedValue({
      state: "succeeded",
      operationId: "operation-1",
      fingerprint: "a".repeat(64),
      kind: "submit_message",
      messageId: "message-1",
      triggerMessageId: "trigger-1",
    });
  });

  it("does not fire when no auto-submit element AND no fallback workflow (plain textarea)", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage([{ id: ELEMENT_ID, type: "textarea" }]),
      totalProposals: 2,
      approvedCount: 2,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire the free-text fallback for PlanFromDesignDoc even when all proposals are approved (plain textarea)", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        workflowName: WorkflowName.PlanFromDesignDoc,
      })
    );

    result.current({
      message: buildMessage([{ id: ELEMENT_ID, type: "textarea" }]),
      totalProposals: 2,
      approvedCount: 2,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("fires the workflow-fallback payload when the message has no uiElements (FeatureSync)", async () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        workflowName: WorkflowName.FeatureSync,
      })
    );

    result.current({
      message: buildMessage([], undefined, LocalPromptType.FeatureSyncAnalyze),
      totalProposals: 1,
      approvedCount: 1,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: [],
    });

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledTimes(1);
    });
  });

  it("fires the workflow fallback for a Feature Sync iterate-authored message", async () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        workflowName: WorkflowName.FeatureSync,
      })
    );

    result.current({
      message: buildMessage([], undefined, LocalPromptType.FeatureSyncIterate),
      totalProposals: 1,
      approvedCount: 1,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: [],
    });

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ["missing author identity", undefined],
    ["a later agent", LocalPromptType.Implement],
    ["plan-shaping analyze", LocalPromptType.PlanShapingFeatureSyncAnalyze],
    ["plan-shaping iterate", LocalPromptType.PlanShapingFeatureSyncIterate],
  ])("does not fire the workflow fallback for %s", (_label, promptHandler) => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        workflowName: WorkflowName.FeatureSync,
      })
    );

    result.current({
      message: buildMessage([], undefined, promptHandler),
      totalProposals: 1,
      approvedCount: 1,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fall back to workflow free-text when a registered autoSubmit element is present but declines to fire", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        workflowName: WorkflowName.FeatureSync,
      })
    );

    // plan_generation_stage_review claims the message but its approve_all
    // secondary action is missing — registry strategy declines. The workflow
    // fallback must NOT post a free-text message in its place, because that
    // would bypass the gate the element owns.
    result.current({
      message: buildMessage([
        { id: ELEMENT_ID, type: "plan_generation_stage_review" },
      ]),
      totalProposals: 2,
      approvedCount: 2,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire workflow fallback when workflowName is not allowlisted", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        workflowName: "some-other-workflow" as unknown as WorkflowName,
      })
    );

    result.current({
      message: buildMessage([{ id: ELEMENT_ID, type: "textarea" }]),
      totalProposals: 1,
      approvedCount: 1,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire workflow fallback when any proposal is rejected", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        workflowName: WorkflowName.FeatureSync,
      })
    );

    result.current({
      message: buildMessage([], undefined, LocalPromptType.FeatureSyncAnalyze),
      totalProposals: 2,
      approvedCount: 1,
      rejectedCount: 1,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: ["p-2"],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire for agent-reply-textarea even when all proposals are approved (autoSubmit strategy retired)", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage([{ id: ELEMENT_ID, type: "agent-reply-textarea" }]),
      totalProposals: 2,
      approvedCount: 2,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not auto-submit plan_generation_stage_review when all proposals are approved", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage(
        [{ id: ELEMENT_ID, type: "plan_generation_stage_review" }],
        [
          {
            handler: "plan_generation_stage_review_approve_all",
            fieldId: ELEMENT_ID,
            type: "field_action",
            label: "Approve All",
          },
        ]
      ),
      totalProposals: 3,
      approvedCount: 3,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2", "p-3"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire plan_generation_stage_review when the approve_all secondary action is missing from the message", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage([
        { id: ELEMENT_ID, type: "plan_generation_stage_review" },
      ]),
      totalProposals: 2,
      approvedCount: 2,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire when any proposal is rejected (agent-reply-textarea)", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage([{ id: ELEMENT_ID, type: "agent-reply-textarea" }]),
      totalProposals: 2,
      approvedCount: 1,
      rejectedCount: 1,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: ["p-2"],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire when any proposal is rejected (plan_generation_stage_review)", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage(
        [{ id: ELEMENT_ID, type: "plan_generation_stage_review" }],
        [
          {
            handler: "plan_generation_stage_review_approve_all",
            fieldId: ELEMENT_ID,
          },
        ]
      ),
      totalProposals: 2,
      approvedCount: 1,
      rejectedCount: 1,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: ["p-2"],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire when there is no active run", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: null,
      })
    );

    result.current({
      message: buildMessage([{ id: ELEMENT_ID, type: "agent-reply-textarea" }]),
      totalProposals: 2,
      approvedCount: 2,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not fire when there is no conversation", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: null,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage([{ id: ELEMENT_ID, type: "agent-reply-textarea" }]),
      totalProposals: 2,
      approvedCount: 2,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1", "p-2"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not auto-submit when multiple stage-review elements are present", () => {
    const { result } = renderHook(() =>
      useAutoAdvanceFeatureSyncIterate({
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
      })
    );

    result.current({
      message: buildMessage(
        [
          { id: "field-a", type: "plan_generation_stage_review" },
          { id: "field-b", type: "plan_generation_stage_review" },
        ],
        [
          {
            handler: "plan_generation_stage_review_approve_all",
            fieldId: "field-a",
            type: "field_action",
            label: "Approve All",
          },
        ]
      ),
      totalProposals: 1,
      approvedCount: 1,
      rejectedCount: 0,
      acceptedProposalIds: ["p-1"],
      rejectedProposalIds: [],
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  describe("keys the advance off the turn's closing message", () => {
    it("does not auto-submit the closing plan-generation review message", () => {
      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          agentSessionId: "agent-session-1",
          machineId: "machine-1",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
        })
      );

      result.current({
        message: buildClosingMessage(
          [{ id: ELEMENT_ID, type: "plan_generation_stage_review" }],
          [
            {
              handler: "plan_generation_stage_review_approve_all",
              fieldId: ELEMENT_ID,
              type: "field_action",
              label: "Approve All",
            },
          ]
        ),
        totalProposals: 3,
        approvedCount: 3,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1", "p-2", "p-3"],
        rejectedProposalIds: [],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("parents the free-text fallback to the closing message (FeatureSync)", async () => {
      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          agentSessionId: "agent-session-1",
          machineId: "machine-1",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          workflowName: WorkflowName.FeatureSync,
        })
      );

      result.current({
        message: buildClosingMessage(
          [],
          undefined,
          LocalPromptType.FeatureSyncIterate
        ),
        totalProposals: 1,
        approvedCount: 1,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1"],
        rejectedProposalIds: [],
      });

      await waitFor(() => {
        expect(postMessage).toHaveBeenCalledTimes(1);
      });
      const { intent: message } = postMessage.mock.calls[0]![0];
      const body = message as Record<string, unknown>;
      expect((body.data as Record<string, unknown>).triggerMessageId).toBe(
        CLOSING_MESSAGE_ID
      );
    });
  });
});
