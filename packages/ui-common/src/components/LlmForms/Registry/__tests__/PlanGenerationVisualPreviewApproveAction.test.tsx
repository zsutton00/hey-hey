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
  SecondaryActionHandler,
  type SecondaryActionConfig,
  type UIElement,
} from "../../../../api";
import { useConversationEvents } from "../../../Conversation/hooks/useConversationEvents";
import { getButtonSecondActions } from "../../../Conversation/utils/conversationFormHelpers";
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
  label: "Next Visual",
  handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
  presentation: "BUTTON",
  fieldId: feedbackElement.id,
};

const createApproveAction = (handleNext: ReturnType<typeof vi.fn>) => {
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
  };
  const [action] = getButtonSecondActions(
    { secondaryActions: [approveAction] },
    [feedbackElement],
    "feedback-message",
    vi.fn(),
    handleNext,
    context,
  );
  return action;
};

const mount = () => {
  const handleNext = vi.fn();
  const action = createApproveAction(handleNext);
  render(
    <>
      {action.render?.(
        { [feedbackElement.id]: "" },
        { isSubmissionLocked: false },
      )}
    </>,
  );
  return { handleNext };
};

const mountInFormButtons = (
  state: Pick<
    React.ComponentProps<typeof DynamicFormButtons>,
    "isSubmitting" | "hasSecondaryActionInFlight"
  >,
) => {
  const handleNext = vi.fn();
  const action = createApproveAction(handleNext);
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
      >,
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
});

describe("PlanGenerationVisualPreviewApproveAction", () => {
  it("submits the typed answer exactly once and never decides a visual itself", async () => {
    const user = userEvent.setup();
    const { handleNext } = mount();
    const button = screen.getByTestId("plan-generation-visual-preview-approve");

    await user.click(button);
    await user.click(button).catch(() => undefined);

    expect(handleNext).toHaveBeenCalledTimes(1);
    expect(handleNext).toHaveBeenCalledWith(...approvedAnswer);
    expect(button).toBeDisabled();
    expect(mocks.getProposal).not.toHaveBeenCalled();
    expect(mocks.approveProposal).not.toHaveBeenCalled();
    expect(mocks.rejectProposal).not.toHaveBeenCalled();
  });

  it("re-enables after a failed submission", async () => {
    const user = userEvent.setup();
    const { handleNext } = mount();
    const { result } = renderHook(() => useConversationEvents("conversation"));

    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve"),
    );
    await waitFor(() => expect(handleNext).toHaveBeenCalledTimes(1));

    act(() =>
      result.current.emit({
        type: "submission-error",
        payload: {
          error: new Error("send failed"),
          data: {},
          parentMessageId: "feedback-message",
        },
      }),
    );

    expect(
      screen.getByTestId("plan-generation-visual-preview-approve"),
    ).toBeEnabled();
    await user.click(
      screen.getByTestId("plan-generation-visual-preview-approve"),
    );
    await waitFor(() => expect(handleNext).toHaveBeenCalledTimes(2));
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
        "plan-generation-visual-preview-approve",
      );

      expect(button).toBeDisabled();
      await user.click(button).catch(() => undefined);
      expect(handleNext).not.toHaveBeenCalled();

      rerender({ isSubmitting: false, hasSecondaryActionInFlight: false });
      expect(
        screen.getByTestId("plan-generation-visual-preview-approve"),
      ).toBeEnabled();
    },
  );
});
