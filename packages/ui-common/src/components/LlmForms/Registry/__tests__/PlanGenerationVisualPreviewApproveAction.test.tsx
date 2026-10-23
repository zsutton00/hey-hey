import React from "react";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalStatus,
  SecondaryActionHandler,
  type SecondaryActionConfig,
  type UIElement,
  type MessageResponseDto,
} from "../../../../api";
import {
  applyVisualPreviewPresentationState,
  resolveCurrentVisualPreviewProposalIds,
} from "../../../Conversation/utils/visualPreviewPresentation";
import { useConversationEvents } from "../../../Conversation/hooks/useConversationEvents";
import { getButtonSecondActions } from "../../../Conversation/utils/conversationFormHelpers";
import {
  __resetForTests,
  setLifecycle,
} from "../../../ProposalDispatchers/proposalSelectedStateCache";
import type { SecondaryActionContext } from "../types";
import { DynamicFormButtons } from "../../DynamicFormButtons";

const mocks = vi.hoisted(() => ({
  getProposal: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
}));
vi.mock("../../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../clients/serviceClients")
  >()),
  proposalsClient: {
    getProposal: mocks.getProposal,
    approveProposal: mocks.approveProposal,
    rejectProposal: mocks.rejectProposal,
  },
}));

const feedbackElement: UIElement = {
  id: "feedback",
  type: "textarea",
  label: "Feedback on the visual plan preview",
};
const approveAction: SecondaryActionConfig = {
  id: "visual-preview-approve-action",
  type: "field_action",
  label: "Approve Visual Set",
  handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
  presentation: "BUTTON",
  fieldId: feedbackElement.id,
};

let statuses: Record<string, ProposalStatus>;

const createApproveAction = (
  currentVisualPreviewProposalIds: string[] | undefined,
  handleNext: ReturnType<typeof vi.fn>
) => {
  const context: SecondaryActionContext = {
    conversationId: "conversation",
    organizationId: "org",
    projectId: "project",
    messageData: {
      type: "QUESTIONS",
      nodeId: "plan-shaping-visual-preview-feedback",
      uiElements: [feedbackElement],
      secondaryActions: [approveAction],
    },
    interaction: { proposals: [] },
    currentVisualPreviewProposalIds,
  };
  const [action] = getButtonSecondActions(
    { secondaryActions: [approveAction] },
    [feedbackElement],
    "feedback-message",
    vi.fn(),
    handleNext,
    context
  );
  return action;
};

const mount = (currentVisualPreviewProposalIds: string[] | undefined) => {
  const handleNext = vi.fn();
  const action = createApproveAction(
    currentVisualPreviewProposalIds,
    handleNext
  );
  render(
    <>
      {action.render?.(
        { [feedbackElement.id]: "" },
        { isSubmissionLocked: false }
      )}
    </>
  );
  return { handleNext };
};

const mountInFormButtons = (
  state: Pick<
    React.ComponentProps<typeof DynamicFormButtons>,
    "isSubmitting" | "hasSecondaryActionInFlight"
  >
) => {
  const handleNext = vi.fn();
  const action = createApproveAction(["a", "b"], handleNext);
  const props = {
    uiElements: [feedbackElement],
    secondActions: [action],
    hasContent: false,
    isSubmitted: false,
    showSkeleton: false,
    formValues: { [feedbackElement.id]: "" },
    showButtons: false,
  };
  const view = render(<DynamicFormButtons {...props} {...state} />);
  return {
    handleNext,
    rerender: (
      next: Pick<
        React.ComponentProps<typeof DynamicFormButtons>,
        "isSubmitting" | "hasSecondaryActionInFlight"
      >
    ) => view.rerender(<DynamicFormButtons {...props} {...next} />),
  };
};

const approvedAnswer = [
  { [feedbackElement.id]: { action: "APPROVED", payload: {} } },
  "feedback-message",
  {
    handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
    nodeId: "plan-shaping-visual-preview-feedback",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  statuses = { a: ProposalStatus.Approved, b: ProposalStatus.Draft };
  mocks.getProposal.mockImplementation(
    ({ proposalId }: { proposalId: string }) =>
      Promise.resolve({
        data: { data: { id: proposalId, status: statuses[proposalId] } },
      })
  );
});

describe("PlanGenerationVisualPreviewApproveAction", () => {
  it("continues the current retry gate after manual approval and reload without checking historical proposals", async () => {
    statuses = {
      a: ProposalStatus.Approved,
      b: ProposalStatus.Approved,
      old: ProposalStatus.Draft,
    };
    const message = (id: string, ids: string[]): MessageResponseDto => ({
      id,
      type: "SYSTEM",
      status: "completed",
      conversationId: "conversation",
      projectId: "project",
      createdAt: "2026-01-01T00:00:00Z",
      awaitingResponse: true,
      data: {
        type: "QUESTIONS",
        response: "Approval failed. Retry the current set.",
        detectedIntent: "",
        intentConfidence: 1,
        secondaryActions: [approveAction],
        uiElements: [
          feedbackElement,
          {
            id: "visuals",
            type: "plan_generation_visual_preview",
            label: "Visuals",
            payload: {
              responseType: "plan_generation_visual_preview_v1",
              entries: ids.map((proposalId, presentationOrder) => ({
                proposalId,
                presentationOrder,
                artifactFamily: "mockup",
              })),
            },
          },
        ],
      },
    });
    const retry = message("retry", ["a", "b"]);
    const old = message("old", ["old"]);
    old.responses = [
      {
        ...message("answer", []),
        type: "USER",
        data: { action: "APPROVED", payload: {} },
        responses: [retry],
      },
    ];
    const timeline = applyVisualPreviewPresentationState(
      [old, retry].map((message) => ({
        message,
        state: "completed",
        canEdit: true,
      })),
      structuredClone([old])
    );
    const user = userEvent.setup();
    const { handleNext } = mount(
      resolveCurrentVisualPreviewProposalIds(timeline)
    );
    expect(handleNext).not.toHaveBeenCalled();
    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );
    await waitFor(() =>
      expect(handleNext).toHaveBeenCalledWith(...approvedAnswer)
    );
    expect(
      mocks.getProposal.mock.calls.map(([{ proposalId }]) => proposalId)
    ).toEqual(["a", "b"]);
    expect(mocks.approveProposal).not.toHaveBeenCalled();
  });

  it("asks for confirmation when a current visual is still DRAFT", async () => {
    const user = userEvent.setup();
    const { handleNext } = mount(["a", "b"]);

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );

    expect(
      await screen.findByText(
        "Continuing automatically approves the remaining visual proposals before stage selection."
      )
    ).toBeVisible();
    expect(
      screen.getByText("1 visual in this set is still awaiting review.")
    ).toBeVisible();
    expect(mocks.getProposal).toHaveBeenCalledTimes(2);
    expect(handleNext).not.toHaveBeenCalled();
  });

  it("cancelling submits nothing and changes no proposal", async () => {
    const user = userEvent.setup();
    const { handleNext } = mount(["a", "b"]);

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );
    await user.click(
      await screen.findByTestId("plan-generation-visual-preview-approve-cancel")
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("plan-generation-visual-preview-approve-confirm")
      ).not.toBeInTheDocument()
    );
    expect(handleNext).not.toHaveBeenCalled();
    expect(mocks.approveProposal).not.toHaveBeenCalled();
    expect(mocks.rejectProposal).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("plan-generation-visual-preview-approve")
    ).toBeEnabled();
  });

  it("confirming submits the typed Approve Visual Set answer exactly once", async () => {
    const user = userEvent.setup();
    const { handleNext } = mount(["a", "b"]);

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );
    const confirm = await screen.findByTestId(
      "plan-generation-visual-preview-approve-continue"
    );
    await user.click(confirm);
    await user.click(confirm).catch(() => undefined);

    expect(handleNext).toHaveBeenCalledTimes(1);
    expect(handleNext).toHaveBeenCalledWith(...approvedAnswer);
    expect(
      screen.getByTestId("plan-generation-visual-preview-approve")
    ).toBeDisabled();
    expect(mocks.approveProposal).not.toHaveBeenCalled();
    expect(mocks.rejectProposal).not.toHaveBeenCalled();
  });

  it("re-enables Approve Visual Set after a failed submission", async () => {
    statuses = { a: ProposalStatus.Approved, b: ProposalStatus.Rejected };
    const user = userEvent.setup();
    const { handleNext } = mount(["a", "b"]);
    const { result } = renderHook(() => useConversationEvents("conversation"));

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );
    await waitFor(() => expect(handleNext).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId("plan-generation-visual-preview-approve")
    ).toBeDisabled();

    act(() =>
      result.current.emit({
        type: "submission-error",
        payload: {
          error: new Error("send failed"),
          data: {},
          parentMessageId: "feedback-message",
        },
      })
    );

    expect(
      screen.getByTestId("plan-generation-visual-preview-approve")
    ).toBeEnabled();
    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );
    await waitFor(() => expect(handleNext).toHaveBeenCalledTimes(2));
  });

  it("submits without confirmation when every current visual is decided", async () => {
    statuses = { a: ProposalStatus.Approved, b: ProposalStatus.Rejected };
    const user = userEvent.setup();
    const { handleNext } = mount(["a", "b"]);

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );

    await waitFor(() => expect(handleNext).toHaveBeenCalledTimes(1));
    expect(handleNext).toHaveBeenCalledWith(...approvedAnswer);
    expect(
      screen.queryByTestId("plan-generation-visual-preview-approve-confirm")
    ).not.toBeInTheDocument();
  });

  it("treats a proposal decided this session as decided while the server still reads DRAFT", async () => {
    setLifecycle("b", "applied");
    const user = userEvent.setup();
    const { handleNext } = mount(["a", "b"]);

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );

    await waitFor(() => expect(handleNext).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByTestId("plan-generation-visual-preview-approve-confirm")
    ).not.toBeInTheDocument();
  });

  it("shows a load failure and submits nothing", async () => {
    mocks.getProposal.mockRejectedValueOnce(new Error("Proposal unavailable"));
    const user = userEvent.setup();
    const { handleNext } = mount(["a", "b"]);

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );

    expect(
      await screen.findByTestId("plan-generation-visual-preview-approve-error")
    ).toHaveTextContent("Proposal unavailable");
    expect(handleNext).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("plan-generation-visual-preview-approve")
    ).toBeEnabled();
  });

  it("submits nothing when no current visual set is presented", async () => {
    const user = userEvent.setup();
    const { handleNext } = mount(undefined);

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve")
    );

    expect(
      await screen.findByTestId("plan-generation-visual-preview-approve-error")
    ).toHaveTextContent("The current visual set could not be found.");
    expect(handleNext).not.toHaveBeenCalled();
    expect(mocks.getProposal).not.toHaveBeenCalled();
  });

  it.each([
    { isSubmitting: true, hasSecondaryActionInFlight: false },
    { isSubmitting: false, hasSecondaryActionInFlight: true },
  ])(
    "greys out with the form's other buttons while a submission is in flight (%o)",
    async (lockedState) => {
      const user = userEvent.setup();
      const { handleNext, rerender } = mountInFormButtons(lockedState);
      const button = screen.getByTestId(
        "plan-generation-visual-preview-approve"
      );

      expect(button).toBeDisabled();
      await user.click(button).catch(() => undefined);
      expect(mocks.getProposal).not.toHaveBeenCalled();
      expect(handleNext).not.toHaveBeenCalled();

      rerender({ isSubmitting: false, hasSecondaryActionInFlight: false });
      expect(
        screen.getByTestId("plan-generation-visual-preview-approve")
      ).toBeEnabled();
    }
  );
});
