import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisSystemMessageData } from "../../../api";
import { ProjectContext } from "../../../contexts";
import i18n from "../../../i18n";
import { AnalysisMessage } from "../AnalysisMessage";

const navigate = vi.fn();

const data: AnalysisSystemMessageData = {
  type: "SYSTEM",
  title: "Analysis complete",
  detectedIntent: "plan",
  intentConfidence: 0.95,
  analysis: {
    identifiedTechnologies: [],
    integrationComplexity: "low",
    potentialChallenges: [],
    recommendations: ["Keep the specialized controls"],
  },
};

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <ProjectContext.Provider
          value={{
            organizationId: "organization-1",
            projectId: "project-1",
            navigate,
          }}
        >
          {children}
        </ProjectContext.Provider>
      </I18nextProvider>
    </ThemeProvider>
  </MemoryRouter>
);

const renderAnalysisMessage = (
  response: string,
  options: { isSubmitting?: boolean; onAcknowledge?: () => void } = {}
) => {
  const onAcknowledge = options.onAcknowledge ?? vi.fn();
  render(
    <AnalysisMessage
      data={data}
      response={response}
      onAcknowledge={onAcknowledge}
      isSubmitting={options.isSubmitting ?? false}
    />,
    { wrapper }
  );
  return { onAcknowledge };
};

describe("AnalysisMessage", () => {
  it("renders response Markdown while preserving the specialized content", () => {
    renderAnalysisMessage("Use [shared Markdown](https://example.com) for the response.");

    expect(screen.getByRole("link", { name: "shared Markdown" })).toHaveAttribute(
      "href",
      "https://example.com"
    );
    expect(screen.getByText("Analysis complete")).toBeVisible();
    expect(screen.getByText("Recommendations")).toBeVisible();
    expect(screen.getByText("Keep the specialized controls")).toBeVisible();
  });

  it.each([
    [
      "canonical",
      "Review @[conversation:conversation-123|Planning discussion] next.",
    ],
    [
      "escaped",
      "Review @\\[conversation:conversation-123\\|Planning discussion] next.",
    ],
  ])("renders a %s mention through the interactive shared mention path", async (_format, response) => {
    renderAnalysisMessage(response);

    const mention = screen.getByTestId("mention-badge");
    expect(mention).toHaveAttribute("data-entity-type", "conversation");
    expect(mention).toHaveTextContent("Planning discussion");
    fireEvent.click(mention);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/projects/project-1/resolve-agent-session/conversation-123"
      )
    );
  });

  it("preserves plain response text and acknowledgement behavior", () => {
    const { onAcknowledge } = renderAnalysisMessage("No special formatting.");

    expect(screen.getByText("No special formatting.")).toBeVisible();
    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeEnabled();
    fireEvent.click(nextButton);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("disables acknowledgement while submission is pending", () => {
    renderAnalysisMessage("Submission pending.", { isSubmitting: true });

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
