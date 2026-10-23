import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SecondaryActionConfigPresentationEnum,
  SecondaryActionConfigTypeEnum,
  SecondaryActionHandler,
  SecondaryActionPayloadHandlerTypeEnum,
  SuggestionType,
  TaskContentApplyPayloadAllOfFieldsKeyEnum,
  type SecondaryActionConfig,
} from "../../../api";
import type { SuggestionDecisionStatus } from "../../Conversation/hooks/useSuggestionDecisions";
import { SuggestedContent } from "../SuggestedContent";

const OLD_CONTENT = "legacy";
const NEW_CONTENT = "updated";

const buildSecondaryAction = (): SecondaryActionConfig => ({
  id: "action-1",
  type: SecondaryActionConfigTypeEnum.FormAction,
  presentation: SecondaryActionConfigPresentationEnum.Inline,
  label: "Apply suggestion",
  fieldId: "field-1",
  handler: SecondaryActionHandler.TaskContentApply,
  payload: {
    handlerType: SecondaryActionPayloadHandlerTypeEnum.TaskContentApply,
    initiativeId: "initiative-1",
    fields: [
      {
        key: TaskContentApplyPayloadAllOfFieldsKeyEnum.Description,
        content: NEW_CONTENT,
      },
    ],
  },
});

const buildDecision = (accepted: boolean): SuggestionDecisionStatus => ({
  id: `decision-${accepted ? "accepted" : "rejected"}`,
  type: SuggestionType.TaskContentApply,
  accepted,
  decidedBy: "user-1",
  createdAt: "2026-02-24T00:00:00.000Z",
});

describe("SuggestedContent", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders diff controls before a decision is made", () => {
    render(
      <SuggestedContent
        title="Suggested Content"
        secondaryAction={buildSecondaryAction()}
        getCurrentContent={() => OLD_CONTENT}
        defaultShowDiff
      />
    );

    expect(
      screen.getByTestId("suggested-content-diff-toggle")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("suggested-content-diff-toggle-bottom")
    ).toBeInTheDocument();
    expect(screen.getByText(OLD_CONTENT)).toBeInTheDocument();
    expect(screen.getByText(NEW_CONTENT)).toBeInTheDocument();
  });

  it.each([true, false])(
    "hides diff controls and diff rendering after decision (%s)",
    (accepted) => {
      render(
        <SuggestedContent
          title="Suggested Content"
          secondaryAction={buildSecondaryAction()}
          getCurrentContent={() => OLD_CONTENT}
          defaultShowDiff
          suggestionDecision={buildDecision(accepted)}
        />
      );

      expect(
        screen.queryByTestId("suggested-content-diff-toggle")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("suggested-content-diff-toggle-bottom")
      ).not.toBeInTheDocument();
      expect(screen.queryByText(OLD_CONTENT)).not.toBeInTheDocument();
      expect(screen.getByText(NEW_CONTENT)).toBeInTheDocument();
    }
  );

  it("forces diff visibility and hides toggles in interactive mode", () => {
    render(
      <SuggestedContent
        title="Suggested Content"
        secondaryAction={buildSecondaryAction()}
        getCurrentContent={() => OLD_CONTENT}
        enableInteractiveDiffReview
      />
    );

    expect(
      screen.queryByTestId("suggested-content-diff-toggle")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("suggested-content-diff-toggle-bottom")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("diff-renderer-view-mode-toggle")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("suggested-content-diff-operation-item-0-0-ins")
    ).toBeInTheDocument();
  });

  it("shows per-operation controls on hover and updates decision state", () => {
    render(
      <SuggestedContent
        title="Suggested Content"
        secondaryAction={buildSecondaryAction()}
        getCurrentContent={() => OLD_CONTENT}
        enableInteractiveDiffReview
      />
    );

    const operationElement = screen.getByTestId(
      "suggested-content-diff-operation-item-0-0-ins"
    );

    expect(
      screen.queryByTestId("suggested-content-diff-operation-item-0-0-accept")
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(operationElement);
    fireEvent.click(
      screen.getByTestId("suggested-content-diff-operation-item-0-0-reject")
    );

    expect(operationElement).toHaveAttribute("data-diff-decision", "rejected");
  });

  it("applies reviewed content and treats undecided operations as accepted", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);

    const { unmount } = render(
      <SuggestedContent
        title="Suggested Content"
        secondaryAction={buildSecondaryAction()}
        getCurrentContent={() => OLD_CONTENT}
        enableInteractiveDiffReview
        onAccept={onAccept}
      />
    );

    fireEvent.click(screen.getByTestId("suggested-content-accept-button"));

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
    expect(onAccept.mock.calls[0][0][0].content).toBe(NEW_CONTENT);

    onAccept.mockClear();

    unmount();

    render(
      <SuggestedContent
        title="Suggested Content"
        secondaryAction={buildSecondaryAction()}
        getCurrentContent={() => OLD_CONTENT}
        enableInteractiveDiffReview
        onAccept={onAccept}
      />
    );

    const operationElement = screen.getByTestId(
      "suggested-content-diff-operation-item-0-0-ins"
    );
    fireEvent.mouseEnter(operationElement);
    fireEvent.click(
      screen.getByTestId("suggested-content-diff-operation-item-0-0-reject")
    );
    fireEvent.click(screen.getByTestId("suggested-content-accept-button"));

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
    expect(onAccept.mock.calls[0][0][0].content).toBe(OLD_CONTENT);
  });

  it("applies split-view review decisions when accepting", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);

    render(
      <SuggestedContent
        title="Suggested Content"
        secondaryAction={buildSecondaryAction()}
        getCurrentContent={() => OLD_CONTENT}
        enableInteractiveDiffReview
        onAccept={onAccept}
      />
    );

    fireEvent.click(screen.getByTestId("diff-renderer-view-mode-split"));

    const operationElement = screen.getByTestId(
      "suggested-content-diff-operation-item-0-0-ins"
    );
    fireEvent.mouseEnter(operationElement);
    fireEvent.click(
      screen.getByTestId("suggested-content-diff-operation-item-0-0-reject")
    );
    fireEvent.click(screen.getByTestId("suggested-content-accept-button"));

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
    expect(onAccept.mock.calls[0][0][0].content).toBe(OLD_CONTENT);
  });

  it("restores diff review decisions from localStorage for same message and action", () => {
    const props = {
      title: "Suggested Content",
      secondaryAction: buildSecondaryAction(),
      getCurrentContent: () => OLD_CONTENT,
      enableInteractiveDiffReview: true,
      messageId: "message-1",
    } as const;

    const { rerender } = render(<SuggestedContent {...props} />);

    const operationElement = screen.getByTestId(
      "suggested-content-diff-operation-item-0-0-ins"
    );
    fireEvent.mouseEnter(operationElement);
    fireEvent.click(
      screen.getByTestId("suggested-content-diff-operation-item-0-0-reject")
    );

    rerender(<SuggestedContent {...props} />);

    expect(
      screen.getByTestId("suggested-content-diff-operation-item-0-0-ins")
    ).toHaveAttribute("data-diff-decision", "rejected");
  });
});
