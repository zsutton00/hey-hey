import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReportAudience,
  ReportType,
  ValidationActionTypeEnum,
  type ReportDto,
  type ValidationWalkthroughReportPayload,
} from "../../../api";
import { ValidationWalkthroughReport } from "../viewer/ValidationWalkthroughReport";

const buildReport = (
  payload: ValidationWalkthroughReportPayload | ReportDto["payload"]
): ReportDto => ({
  id: "report-validation",
  organizationId: "org-1",
  audience: ReportAudience.WorkflowOnly,
  reportType: ReportType.ValidationWalkthrough,
  title: "Validation Walkthrough",
  payload,
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-validation",
  createdAt: "2026-05-12T09:00:00.000Z",
  expiresAt: "2026-06-01T09:00:00.000Z",
  entities: [],
});

const basePayload: ValidationWalkthroughReportPayload = {
  summary:
    "Hand-off summary describing how to verify the walkthrough rendering path end to end.",
  reportType: "VALIDATION_WALKTHROUGH",
  validationSteps: [
    {
      title: "Install dependencies",
      description: "Ensure pnpm dependencies are up to date before testing.",
      actions: [
        {
          type: ValidationActionTypeEnum.CommandLine,
          command: "pnpm install",
        },
      ],
    },
    {
      title: "Run targeted test",
      description: "Execute the validation walkthrough test suite.",
      actions: [
        {
          type: ValidationActionTypeEnum.CommandLine,
          command: "pnpm vitest run ValidationWalkthroughReport",
          workingDirectory: "ui-common",
        },
      ],
    },
  ],
};

const setClipboardWriteText = (
  writeText: (text: string) => Promise<void>
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
};

describe("ValidationWalkthroughReport", () => {
  beforeEach(() => {
    setClipboardWriteText(vi.fn().mockResolvedValue(undefined));
  });

  it("renders ordered validation steps with title and description", () => {
    render(
      <ValidationWalkthroughReport
        payload={basePayload}
        report={buildReport(basePayload)}
        reportTestId="vw"
      />
    );

    const stepList = screen.getByTestId("vw-steps");
    expect(stepList.tagName).toBe("OL");

    expect(screen.getByTestId("vw-step-0-title")).toHaveTextContent(
      "1. Install dependencies"
    );
    expect(screen.getByTestId("vw-step-0-description")).toHaveTextContent(
      "Ensure pnpm dependencies are up to date before testing."
    );
    expect(screen.getByTestId("vw-step-1-title")).toHaveTextContent(
      "2. Run targeted test"
    );
  });

  it("renders a command_line action without working directory", () => {
    render(
      <ValidationWalkthroughReport
        payload={basePayload}
        report={buildReport(basePayload)}
        reportTestId="vw"
      />
    );

    expect(
      screen.getByTestId("vw-step-0-action-0-command-line")
    ).toBeInTheDocument();
    expect(screen.getByTestId("vw-step-0-action-0-command")).toHaveTextContent(
      "pnpm install"
    );
    expect(
      screen.queryByTestId("vw-step-0-action-0-working-directory")
    ).not.toBeInTheDocument();
  });

  it("renders a command_line action with workingDirectory hint", () => {
    render(
      <ValidationWalkthroughReport
        payload={basePayload}
        report={buildReport(basePayload)}
        reportTestId="vw"
      />
    );

    expect(
      screen.getByTestId("vw-step-1-action-0-working-directory")
    ).toHaveTextContent("Working directory: ui-common");
    expect(screen.getByTestId("vw-step-1-action-0-command")).toHaveTextContent(
      "pnpm vitest run ValidationWalkthroughReport"
    );
  });

  it("copies the command to the clipboard when the copy button is clicked", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboardWriteText(writeText);

    render(
      <ValidationWalkthroughReport
        payload={basePayload}
        report={buildReport(basePayload)}
        reportTestId="vw"
      />
    );

    await user.click(screen.getByTestId("vw-step-0-action-0-copy"));

    expect(writeText).toHaveBeenCalledWith("pnpm install");
    await waitFor(() => {
      expect(screen.getByTestId("vw-step-0-action-0-copy")).toHaveTextContent(
        "Copied"
      );
    });
  });

  it("renders a fallback for unknown action types", () => {
    const payload: ValidationWalkthroughReportPayload = {
      ...basePayload,
      validationSteps: [
        {
          title: "Open the browser",
          description: "Navigate to the staging UI.",
          actions: [
            {
              type: "browser_navigate" as unknown as typeof ValidationActionTypeEnum.CommandLine,
            },
          ],
        },
      ],
    };

    render(
      <ValidationWalkthroughReport
        payload={payload}
        report={buildReport(payload)}
        reportTestId="vw"
      />
    );

    expect(screen.getByTestId("vw-step-0-action-0-unknown")).toHaveTextContent(
      "Unsupported action type: browser_navigate"
    );
  });

  it("renders an empty state when the payload is missing validationSteps", () => {
    render(
      <ValidationWalkthroughReport
        payload={{} as ValidationWalkthroughReportPayload}
        report={buildReport({})}
        reportTestId="vw"
      />
    );

    expect(screen.getByTestId("vw-empty")).toHaveTextContent(
      "Validation walkthrough payload is unavailable."
    );
  });
});
