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

const ORG_ID = "org-1";
const PROJECT_ID = "proj-1";
const CONVERSATION_ID = "conv-1";
const TRIGGERING_MESSAGE_ID = "msg-system-1";
const RUN_ID = "run-1";
const ELEMENT_ID = "stage-review-field-1";

const operationContext = {
  agentSessionId: "agent-session-1",
  machineId: "machine-1",
} as const;

const buildStageReviewMessage = (): MessageResponseDto =>
  ({
    id: TRIGGERING_MESSAGE_ID,
    type: "SYSTEM",
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    organizationId: ORG_ID,
    data: {
      type: "QUESTIONS",
      nodeId: "plan-stage-review-node",
      uiElements: [
        {
          id: ELEMENT_ID,
          type: "plan_generation_stage_review",
          label: "Stage Review",
        },
      ],
      secondaryActions: [
        {
          id: "action-approve-all",
          handler: "plan_generation_stage_review_approve_all",
          fieldId: ELEMENT_ID,
          type: "field_action",
          label: "Approve All",
        },
      ],
    },
  } as unknown as MessageResponseDto);

describe("auto-advance (element-type-driven)", () => {
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

  describe("plan_generation_stage_review element", () => {
    it("waits for the explicit readiness action when all proposals are approved", () => {
      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
        })
      );

      result.current({
        message: buildStageReviewMessage(),
        totalProposals: 3,
        approvedCount: 3,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1", "p-2", "p-3"],
        rejectedProposalIds: [],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("does not send when the approve_all secondary action is absent from the message", () => {
      const messageWithoutApproveAll: MessageResponseDto = {
        id: TRIGGERING_MESSAGE_ID,
        type: "SYSTEM",
        conversationId: CONVERSATION_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        data: {
          type: "QUESTIONS",
          uiElements: [
            {
              id: ELEMENT_ID,
              type: "plan_generation_stage_review",
              label: "Stage Review",
            },
          ],
          secondaryActions: [
            {
              id: "action-continue",
              handler: "plan_generation_stage_review_continue_revising",
              fieldId: ELEMENT_ID,
              type: "field_action",
              label: "Continue Revising",
            },
          ],
        },
      } as unknown as MessageResponseDto;

      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
        })
      );

      result.current({
        message: messageWithoutApproveAll,
        totalProposals: 2,
        approvedCount: 2,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1", "p-2"],
        rejectedProposalIds: [],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("does not send when proposals include a rejection", () => {
      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
        })
      );

      result.current({
        message: buildStageReviewMessage(),
        totalProposals: 2,
        approvedCount: 1,
        rejectedCount: 1,
        acceptedProposalIds: ["p-1"],
        rejectedProposalIds: ["p-2"],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe("PlanFromDesignDoc regression", () => {
    const GATE_ELEMENT_ID = "plan-shaping-review-field-1";

    const buildPlanShapingGateMessage = (): MessageResponseDto =>
      ({
        id: TRIGGERING_MESSAGE_ID,
        type: "SYSTEM",
        conversationId: CONVERSATION_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        data: {
          type: "QUESTIONS",
          uiElements: [
            { id: GATE_ELEMENT_ID, type: "plan_shaping_feature_sync_review" },
          ],
          secondaryActions: [
            {
              id: "action-done",
              handler: SecondaryActionHandler.PlanShapingFeatureSyncReviewDone,
              fieldId: GATE_ELEMENT_ID,
              type: "field_action",
              label: "Done with Feature Sync",
            },
          ],
        },
      } as unknown as MessageResponseDto);

    const buildPlanShapingNonGateMessage = (): MessageResponseDto =>
      ({
        id: TRIGGERING_MESSAGE_ID,
        type: "SYSTEM",
        conversationId: CONVERSATION_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        data: {
          type: "QUESTIONS",
          uiElements: [
            { id: GATE_ELEMENT_ID, type: "plan_shaping_feature_sync_review" },
          ],
          secondaryActions: [],
        },
      } as unknown as MessageResponseDto);

    beforeEach(() => {
      postMessage.mockClear();
    });

    it("approving every proposal on a non-gate plan-from-design-doc message posts nothing", () => {
      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          workflowName: WorkflowName.PlanFromDesignDoc,
        })
      );

      result.current({
        message: buildPlanShapingNonGateMessage(),
        totalProposals: 3,
        approvedCount: 3,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1", "p-2", "p-3"],
        rejectedProposalIds: [],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("approving every proposal on the review-gate message posts nothing (autoSubmit disabled)", () => {
      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          workflowName: WorkflowName.PlanFromDesignDoc,
        })
      );

      result.current({
        message: buildPlanShapingGateMessage(),
        totalProposals: 3,
        approvedCount: 3,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1", "p-2", "p-3"],
        rejectedProposalIds: [],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("the canned text 'All proposals approved...' appears in no posted payload under any plan-from-design-doc combination", async () => {
      const scenarios: Array<{
        label: string;
        buildMessage: () => MessageResponseDto;
        workflowName?: WorkflowName;
        expectsPost: boolean;
      }> = [
        {
          label: "PlanFromDesignDoc, no uiElements",
          buildMessage: () =>
            ({
              id: TRIGGERING_MESSAGE_ID,
              type: "SYSTEM",
              conversationId: CONVERSATION_ID,
              projectId: PROJECT_ID,
              organizationId: ORG_ID,
              data: { type: "QUESTIONS", uiElements: [] },
            } as unknown as MessageResponseDto),
          workflowName: WorkflowName.PlanFromDesignDoc,
          expectsPost: false,
        },
        {
          label:
            "PlanFromDesignDoc, plan_shaping_feature_sync_review without done action",
          buildMessage: buildPlanShapingNonGateMessage,
          workflowName: WorkflowName.PlanFromDesignDoc,
          expectsPost: false,
        },
        {
          label: "review-gate with done action (autoSubmit disabled, no post)",
          buildMessage: buildPlanShapingGateMessage,
          workflowName: WorkflowName.PlanFromDesignDoc,
          expectsPost: false,
        },
      ];

      for (const scenario of scenarios) {
        const localPost = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() =>
          useAutoAdvanceFeatureSyncIterate({
            ...operationContext,
            organizationId: ORG_ID,
            projectId: PROJECT_ID,
            conversationId: CONVERSATION_ID,
            runId: RUN_ID,
            workflowName: scenario.workflowName,
          })
        );

        result.current({
          message: scenario.buildMessage(),
          totalProposals: 2,
          approvedCount: 2,
          rejectedCount: 0,
          acceptedProposalIds: ["p-1", "p-2"],
          rejectedProposalIds: [],
        });

        if (scenario.expectsPost) {
          await waitFor(() => expect(localPost).toHaveBeenCalledTimes(1));
        }

        for (const call of localPost.mock.calls) {
          const msg = call[2] as Record<string, unknown>;
          expect(JSON.stringify(msg.data)).not.toContain(
            AUTO_ADVANCE_MESSAGE_TEXT
          );
        }
      }
    });

    it("FeatureSync task-anchored fallback still fires, pinning the deferred flow's behavior", async () => {
      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          workflowName: WorkflowName.FeatureSync,
        })
      );

      result.current({
        message: {
          id: TRIGGERING_MESSAGE_ID,
          type: "SYSTEM",
          conversationId: CONVERSATION_ID,
          projectId: PROJECT_ID,
          organizationId: ORG_ID,
          data: {
            type: "QUESTIONS",
            uiElements: [],
            promptHandler: LocalPromptType.FeatureSyncAnalyze,
          },
        } as unknown as MessageResponseDto,
        totalProposals: 2,
        approvedCount: 2,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1", "p-2"],
        rejectedProposalIds: [],
      });

      await waitFor(() => {
        expect(postMessage).toHaveBeenCalledTimes(1);
      });
      const {
        organizationId: orgId,
        projectId: projectId,
        intent: message,
      } = postMessage.mock.calls[0]![0];
      expect(orgId).toBe(ORG_ID);
      expect(projectId).toBe(PROJECT_ID);
      const body = message as Record<string, unknown>;
      expect(body.conversationId).toBe(CONVERSATION_ID);
      expect(body.type).toBe(MessageType.User);
      expect(body.parentMessageId).toBeNull();
      expect(body.handler).toBeUndefined();
      expect(body.data).toEqual({
        agentInput: {
          promptType: LocalPromptType.WorkflowDefined,
          userMessage: AUTO_ADVANCE_MESSAGE_TEXT,
        },
        references: { resolved: [], unresolved: [] },
        attachUserMessageData: true,
        triggerMessageId: TRIGGERING_MESSAGE_ID,
      });
    });
  });

  describe("no auto-submit elements", () => {
    it("does not send when uiElements contains only plain textarea", () => {
      const plainMessage: MessageResponseDto = {
        id: TRIGGERING_MESSAGE_ID,
        type: "SYSTEM",
        conversationId: CONVERSATION_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "t-1", type: "textarea", label: "Reply" }],
        },
      } as unknown as MessageResponseDto;

      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
        })
      );

      result.current({
        message: plainMessage,
        totalProposals: 2,
        approvedCount: 2,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1", "p-2"],
        rejectedProposalIds: [],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("does not send when uiElements is empty", () => {
      const emptyMessage: MessageResponseDto = {
        id: TRIGGERING_MESSAGE_ID,
        type: "SYSTEM",
        data: { type: "QUESTIONS", uiElements: [] },
      } as unknown as MessageResponseDto;

      const { result } = renderHook(() =>
        useAutoAdvanceFeatureSyncIterate({
          ...operationContext,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
        })
      );

      result.current({
        message: emptyMessage,
        totalProposals: 1,
        approvedCount: 1,
        rejectedCount: 0,
        acceptedProposalIds: ["p-1"],
        rejectedProposalIds: [],
      });

      expect(postMessage).not.toHaveBeenCalled();
    });
  });
});
