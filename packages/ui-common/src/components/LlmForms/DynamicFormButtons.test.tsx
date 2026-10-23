import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import { DynamicFormButtons } from "./DynamicFormButtons";
import { SecondaryActionHandler } from "../../api";
import {
  PlanGenerationVisualPreviewApproveHandler,
  PlanGenerationVisualPreviewContinueRevisingHandler,
} from "./Registry/types";
import type { SecondaryActionHandlerKey } from "./Registry/types";

const theme = createTheme({
  palette: {
    actionable: {
      main: "#124e78",
      dark: "#0b3552",
      contrastText: "#ffffff",
    },
  },
});

const createAction = (handler: SecondaryActionHandlerKey) => ({
  type: "field_action" as const,
  label:
    handler === PlanGenerationVisualPreviewContinueRevisingHandler
      ? "Continue Revising"
      : "Approve Visual Set",
  onExecute: vi.fn(),
  submitsForm: true,
  presentation: "BUTTON" as const,
  handler,
});

const renderButtons = (
  secondActions: React.ComponentProps<typeof DynamicFormButtons>["secondActions"],
) =>
  render(
    <ThemeProvider theme={theme}>
      <DynamicFormButtons
        uiElements={[]}
        hasContent
        isSubmitted={false}
        secondActions={secondActions}
        showSkeleton={false}
        formValues={{}}
      />
    </ThemeProvider>,
  );

describe("DynamicFormButtons", () => {
  it("hides the standard Send button for visual-preview workflow actions", () => {
    renderButtons([
      createAction(PlanGenerationVisualPreviewContinueRevisingHandler),
      createAction(PlanGenerationVisualPreviewApproveHandler),
    ]);

    expect(screen.queryByTestId("run-stream-external-reply-submit")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("keeps the standard Send button for unrelated secondary actions", () => {
    renderButtons([
      {
        ...createAction(PlanGenerationVisualPreviewApproveHandler),
        handler: SecondaryActionHandler.TaskGenerationGenerate,
      },
    ]);

    expect(screen.getByTestId("run-stream-external-reply-submit")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
