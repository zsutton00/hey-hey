import React from "react";
import { waitFor, render, screen } from "@testing-library/react";
import userEvent, {
  PointerEventsCheckLevel,
} from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ProposalStatus,
  type SecondaryActionConfig,
  type UIElement,
} from "../../../../api";
import { getButtonSecondActions } from "../../../Conversation/utils/conversationFormHelpers";
import { toProposalId } from "../../../Conversation/hooks/proposalsAcceptedTypes";
import { PlanGenerationStageReviewField } from "../PlanGenerationStageReviewField";

vi.mock("../../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: ({ value }: { value: string }) => (
    <textarea aria-label="stage feedback" value={value} readOnly />
  ),
}));

const stageReviewElement: UIElement = {
  id: "stage-review",
  type: "plan_generation_stage_review",
  label: "Review the proposed stages",
  payload: { expectedStageCount: 2 },
};

const actions: SecondaryActionConfig[] = [
  {
    id: "continue-revising",
    type: "field_action",
    label: "Continue Revising",
    fieldId: stageReviewElement.id,
    handler: "plan_generation_stage_review_continue_revising",
    disabled: false,
    presentation: "BUTTON",
  },
  {
    id: "ready",
    type: "field_action",
    label: "Ready for next step",
    fieldId: stageReviewElement.id,
    handler: "plan_generation_stage_review_approve_all",
    disabled: false,
    presentation: "BUTTON",
  },
];

describe("PlanGenerationStageReviewField", () => {
  it("renders feedback without inventing field-owned buttons", () => {
    render(
      <PlanGenerationStageReviewField
        config={{
          field: stageReviewElement.id,
          type: stageReviewElement.type,
          description: stageReviewElement.label,
        }}
        context={{
          messageData: { type: "QUESTIONS", uiElements: [stageReviewElement] },
          conversationId: "conversation",
          organizationId: "organization",
          projectId: "project",
          interaction: { proposals: [] },
        }}
        value={{ payload: { feedback: "" } }}
        isSubmitted={false}
      />
    );
    expect(screen.getByLabelText("stage feedback")).toBeInTheDocument();
  });

  it.each([
    [2, 1],
    [2, 2],
  ])(
    "uses current field totals %s then %s despite other fields and older metadata",
    async (first, second) => {
      const user = userEvent.setup();
      const handleNext = vi.fn();
      const values = { "stage-review": { payload: { feedback: "" } } };
      const renderReady = (count: number, messageId: string) => {
        const fields = [
          {
            ...stageReviewElement,
            id: "other-field",
            payload: { expectedStageCount: 99 },
          },
          { ...stageReviewElement, payload: { expectedStageCount: count } },
        ];
        return getButtonSecondActions(
          { secondaryActions: actions },
          fields,
          messageId,
          vi.fn(),
          handleNext,
          {
            conversationId: "conversation",
            organizationId: "organization",
            projectId: "project",
            messageData: { type: "QUESTIONS", uiElements: fields },
            parentMessageData: {
              type: "AGENT",
              completesExternalAgentNode: {
                action: "READY",
                nodeId: "plan-shaping-proposed-stages",
                completesTriggerMessageId: "old-revision",
                payload: { expectedStageCount: 99 },
              },
            },
            interaction: {
              proposals: [
                {
                  proposalId: toProposalId("current"),
                  lifecycle: ProposalStatus.Approved,
                  targetWorkItemType: "PLAN_STAGE",
                },
              ],
            },
          }
        ).find(({ label }) => label === "Ready for next step")!.render!(values, { isSubmissionLocked: false });
      };
      const { rerender } = render(<>{renderReady(first, "first-message")}</>);
      await user.click(
        screen.getByTestId("plan-generation-stage-review-ready")
      );
      expect(screen.getByText("1/2 stages are approved.")).toBeVisible();
      rerender(<>{renderReady(second, "second-message")}</>);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(
        screen.getByTestId("plan-generation-stage-review-ready")
      );
      if (second === 2) {
        expect(screen.getByText("1/2 stages are approved.")).toBeVisible();
        expect(
          screen.queryByRole("button", { name: "Continue anyway" })
        ).not.toBeInTheDocument();
        expect(handleNext).not.toHaveBeenCalled();
      } else {
        expect(handleNext).toHaveBeenCalledExactlyOnceWith(
          { "stage-review": { action: "APPROVED", payload: {} } },
          "second-message",
          { handler: "plan_generation_stage_review_approve_all" }
        );
      }
    }
  );

  it("renders Ready for next step from the message secondaryActions", () => {
    const secondActions = getButtonSecondActions(
      { secondaryActions: actions },
      [stageReviewElement],
      "message",
      vi.fn(),
      vi.fn(),
      {
        messageData: { type: "QUESTIONS", uiElements: [stageReviewElement] },
        conversationId: "conversation",
        organizationId: "organization",
        projectId: "project",
        interaction: { proposals: [] },
      }
    );

    expect(secondActions.map(({ label }) => label)).toEqual([
      "Continue Revising",
      "Ready for next step",
    ]);
    expect(
      secondActions.every(({ presentation }) => presentation === "BUTTON")
    ).toBe(true);
  });

  it("enables after the first approval and warns before continuing with one of two stages", async () => {
    const user = userEvent.setup();
    const handleNext = vi.fn();
    const values = { "stage-review": { payload: { feedback: "" } } };
    const readyAction = (approved: boolean) =>
      getButtonSecondActions(
        { secondaryActions: actions },
        [stageReviewElement],
        "message",
        vi.fn(),
        handleNext,
        {
          messageData: { type: "QUESTIONS", uiElements: [stageReviewElement] },
          conversationId: "conversation",
          organizationId: "organization",
          projectId: "project",
          parentMessageData: {
            type: "AGENT",
            completesExternalAgentNode: {
              action: "READY",
              nodeId: "plan-shaping-proposed-stages",
              completesTriggerMessageId: "trigger",
              payload: { expectedStageCount: 99 },
            },
          },
          interaction: {
            proposals: [
              {
                proposalId: toProposalId("first"),
                lifecycle: approved
                  ? ProposalStatus.Approved
                  : ProposalStatus.Draft,
                targetWorkItemType: "PLAN_STAGE",
              },
              {
                proposalId: toProposalId("second"),
                lifecycle: ProposalStatus.Draft,
                targetWorkItemType: "PLAN_STAGE",
              },
            ],
          },
        }
      ).find(({ label }) => label === "Ready for next step")!;
    const { rerender } = render(<>{readyAction(false).render?.(values, { isSubmissionLocked: false })}</>);
    expect(
      screen.getByTestId("plan-generation-stage-review-ready")
    ).toBeDisabled();
    rerender(<>{readyAction(true).render?.(values, { isSubmissionLocked: false })}</>);
    expect(
      screen.getByTestId("plan-generation-stage-review-ready")
    ).toBeEnabled();
    expect(handleNext).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("plan-generation-stage-review-ready"));
    expect(screen.getByText("1/2 stages are approved.")).toBeVisible();
    expect(handleNext).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Acknowledged" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Continue anyway" })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Please reject any undesired stage/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Acknowledged" }));
    expect(handleNext).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("submits APPROVED directly when the completion-authored count matches", async () => {
    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    const handleNext = vi.fn();
    const secondActions = getButtonSecondActions(
      { secondaryActions: actions },
      [stageReviewElement],
      "message",
      vi.fn(),
      handleNext,
      {
        messageData: { type: "QUESTIONS", uiElements: [stageReviewElement] },
        conversationId: "conversation",
        organizationId: "organization",
        projectId: "project",
        parentMessageData: {
          type: "AGENT",
          response: "",
          detectedIntent: "agent_submission",
          intentConfidence: 1,
          completesExternalAgentNode: {
            action: "READY",
            nodeId: "plan-shaping-proposed-stages",
            completesTriggerMessageId: "revision",
            payload: { expectedStageCount: 99 },
          },
        },
        interaction: {
          proposals: [
            {
              proposalId: toProposalId("one"),
              lifecycle: ProposalStatus.Approved,
              targetWorkItemType: "PLAN_STAGE",
            },
            {
              proposalId: toProposalId("two"),
              lifecycle: ProposalStatus.Approved,
              targetWorkItemType: "PLAN_STAGE",
            },
          ],
        },
      }
    );
    const ready = secondActions.find(
      ({ label }) => label === "Ready for next step"
    )!;
    render(
      <>{ready.render?.({ "stage-review": { payload: { feedback: "" } } }, { isSubmissionLocked: false })}</>
    );

    await user.click(screen.getByTestId("plan-generation-stage-review-ready"));

    expect(handleNext).toHaveBeenCalledWith(
      { "stage-review": { action: "APPROVED", payload: {} } },
      "message",
      { handler: "plan_generation_stage_review_approve_all" }
    );
  });

  it("ignores approved non-stage proposals when checking stage readiness", async () => {
    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    const handleNext = vi.fn();
    const approvedProposal = (
      id: string,
      targetWorkItemType: string | null
    ) => ({
      proposalId: toProposalId(id),
      lifecycle: ProposalStatus.Approved,
      targetWorkItemType,
    });
    const secondActions = getButtonSecondActions(
      { secondaryActions: actions },
      [stageReviewElement],
      "message",
      vi.fn(),
      handleNext,
      {
        messageData: { type: "QUESTIONS", uiElements: [stageReviewElement] },
        conversationId: "conversation",
        organizationId: "organization",
        projectId: "project",
        interaction: {
          proposals: [
            approvedProposal("earlier-task", "STANDARD"),
            approvedProposal("earlier-design-doc", null),
            approvedProposal("earlier-service", null),
            approvedProposal("earlier-plan", "PLAN"),
            approvedProposal("stage-one", "PLAN_STAGE"),
            approvedProposal("stage-two", "PLAN_STAGE"),
          ],
        },
      }
    );
    const ready = secondActions.find(
      ({ label }) => label === "Ready for next step"
    )!;
    render(
      <>{ready.render?.({ "stage-review": { payload: { feedback: "" } } }, { isSubmissionLocked: false })}</>
    );

    await user.click(screen.getByTestId("plan-generation-stage-review-ready"));

    expect(handleNext).toHaveBeenCalledWith(
      { "stage-review": { action: "APPROVED", payload: {} } },
      "message",
      { handler: "plan_generation_stage_review_approve_all" }
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByText("6/2 stages are approved.")
    ).not.toBeInTheDocument();
  });

  it("acknowledges a mismatch without submitting or changing feedback", async () => {
    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    const handleNext = vi.fn();
    const secondActions = getButtonSecondActions(
      { secondaryActions: actions },
      [stageReviewElement],
      "message",
      vi.fn(),
      handleNext,
      {
        messageData: { type: "QUESTIONS", uiElements: [stageReviewElement] },
        conversationId: "conversation",
        organizationId: "organization",
        projectId: "project",
        parentMessageData: {
          type: "AGENT",
          response: "",
          detectedIntent: "agent_submission",
          intentConfidence: 1,
          completesExternalAgentNode: {
            action: "READY",
            nodeId: "plan-shaping-proposed-stages",
            completesTriggerMessageId: "revision",
            payload: { expectedStageCount: 99 },
          },
        },
        interaction: {
          proposals: [
            {
              proposalId: toProposalId("one"),
              lifecycle: ProposalStatus.Approved,
              targetWorkItemType: "PLAN_STAGE",
            },
            {
              proposalId: toProposalId("two"),
              lifecycle: ProposalStatus.Draft,
              targetWorkItemType: "PLAN_STAGE",
            },
          ],
        },
      }
    );
    const ready = secondActions.find(
      ({ label }) => label === "Ready for next step"
    )!;
    const values = { "stage-review": { payload: { feedback: "Revise this" } } };
    render(<>{ready.render?.(values, { isSubmissionLocked: false })}</>);

    const readyButton = screen.getByTestId(
      "plan-generation-stage-review-ready"
    );
    expect(readyButton).toBeEnabled();
    await user.click(readyButton);
    expect(screen.getByText("1/2 stages are approved.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue anyway" })
    ).not.toBeInTheDocument();
    expect(handleNext).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Acknowledged" }));
    expect(handleNext).not.toHaveBeenCalled();
    expect(values["stage-review"].payload.feedback).toBe("Revise this");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("disables readiness when proposal state contains no approved stages", async () => {
    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    const handleNext = vi.fn();
    const secondActions = getButtonSecondActions(
      { secondaryActions: actions },
      [stageReviewElement],
      "message",
      vi.fn(),
      handleNext,
      {
        messageData: { type: "QUESTIONS", uiElements: [stageReviewElement] },
        conversationId: "conversation",
        organizationId: "organization",
        projectId: "project",
        interaction: {
          proposals: [
            {
              proposalId: toProposalId("one"),
              lifecycle: ProposalStatus.Draft,
              targetWorkItemType: "PLAN_STAGE",
            },
            {
              proposalId: toProposalId("two"),
              lifecycle: ProposalStatus.Rejected,
              targetWorkItemType: "PLAN_STAGE",
            },
          ],
        },
      }
    );
    const ready = secondActions.find(
      ({ label }) => label === "Ready for next step"
    )!;
    render(
      <>{ready.render?.({ "stage-review": { payload: { feedback: "" } } }, { isSubmissionLocked: false })}</>
    );

    const button = screen.getByTestId("plan-generation-stage-review-ready");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(button).toHaveAttribute("disabled");
    expect(handleNext).not.toHaveBeenCalled();
  });

  it("enables only after a live approval with the current field total", async () => {
    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    const handleNext = vi.fn();
    const renderActions = (lifecycle?: ProposalStatus) =>
      getButtonSecondActions(
        { secondaryActions: actions },
        [stageReviewElement],
        "message",
        vi.fn(),
        handleNext,
        {
          messageData: {
            type: "QUESTIONS",
            uiElements: [
              { ...stageReviewElement, payload: { expectedStageCount: 1 } },
            ],
          },
          conversationId: "conversation",
          organizationId: "organization",
          projectId: "project",
          interaction: {
            proposals: lifecycle
              ? [
                  {
                    proposalId: toProposalId("stage"),
                    lifecycle,
                    targetWorkItemType: "PLAN_STAGE",
                  },
                ]
              : [],
          },
        }
      );
    const secondActions = renderActions();
    const ready = secondActions.find(
      ({ label }) => label === "Ready for next step"
    )!;
    const values = { "stage-review": { payload: { feedback: "" } } };
    const { rerender } = render(<>{ready.render?.(values, { isSubmissionLocked: false })}</>);
    const button = screen.getByTestId("plan-generation-stage-review-ready");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(handleNext).not.toHaveBeenCalled();
    for (const lifecycle of [
      ProposalStatus.Draft,
      ProposalStatus.Approved,
      ProposalStatus.Rejected,
    ]) {
      const action = renderActions(lifecycle).find(
        ({ label }) => label === "Ready for next step"
      )!;
      rerender(<>{action.render?.(values, { isSubmissionLocked: false })}</>);
      if (lifecycle === ProposalStatus.Approved) {
        expect(button).toBeEnabled();
        await user.click(button);
      } else {
        expect(button).toBeDisabled();
        await user.click(button);
      }
    }
    expect(handleNext).toHaveBeenCalledTimes(1);
  });
});
