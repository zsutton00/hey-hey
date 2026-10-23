import React from "react";
import { screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockConversation,
  createMockConversationMessage,
  renderWithConversationProvider,
} from "./conversationTestUtils";
import { ConversationStatusIndicator } from "../ConversationStatusIndicator";
import { KEYS } from "../../../../i18n/keys";
import { ConversationStatus } from "../../../../api";

const translationSpy = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    "conversation.failed": "Operation failed",
    "conversation.completed": "Completed successfully",
  };

  return translations[key] || key;
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translationSpy,
  }),
}));

describe("ConversationStatusIndicator", () => {
  const theme = createTheme();
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ThemeProvider theme={theme}>{children}</ThemeProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    translationSpy.mockClear();
  });

  it("renders an error alert when the workflow has failed", async () => {
    const message = createMockConversationMessage();

    await renderWithConversationProvider(
      <Wrapper>
        <ConversationStatusIndicator data-testid="status" />
      </Wrapper>,
      {
        timeline: [message],
        workflowStatus: {
          status: "failed",
          message: "Something went wrong",
        },
      }
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
  });

  it("falls back to the default failure translation when no message provided", async () => {
    const message = createMockConversationMessage();

    await renderWithConversationProvider(
      <Wrapper>
        <ConversationStatusIndicator />
      </Wrapper>,
      {
        timeline: [message],
        workflowStatus: {
          status: "failed",
        },
      }
    );

    await waitFor(() => {
      expect(translationSpy).toHaveBeenCalledWith(KEYS.conversation.failed);
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Operation failed");
  });

  it("does not render status UI when the conversation is generating a response", async () => {
    const message = createMockConversationMessage();

    await renderWithConversationProvider(
      <Wrapper>
        <ConversationStatusIndicator />
      </Wrapper>,
      {
        timeline: [message],
        workflowStatus: {
          status: "failed",
          message: "Should not show while generating",
        },
        animationType: "minimal",
        conversationOverride: createMockConversation({
          status: ConversationStatus.GeneratingResponse,
        }),
      }
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
