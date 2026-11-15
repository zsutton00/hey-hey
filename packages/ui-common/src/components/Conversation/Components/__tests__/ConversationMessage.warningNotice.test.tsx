import type React from "react";
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHeyTheme } from "../../../../contexts/ThemeContext";
import { MessageType } from "../../../../api";
import { ConversationMessage as ResolvedConversationMessage } from "../ConversationMessage";
import { resolveConversationForm } from "../../utils/conversationResponseModel";
import { useConversationContext } from "../ConversationContext";
import { createMockConversationMessage } from "./conversationTestUtils";

// The shared test setup stubs react-markdown with a link-only parser; these
// tests need the real renderer so fenced code and links parse as in production.
vi.mock(
  "react-markdown",
  () => import("../../../../../node_modules/react-markdown/index.js"),
);

vi.mock("../ConversationContext", () => ({
  useConversationContext: vi.fn(),
}));

const ConversationMessage = (
  props: React.ComponentProps<typeof ResolvedConversationMessage>,
) => {
  const context = useConversationContext();
  context.resolvedForms = new Map([
    [
      props.conversationMessage.message.id,
      resolveConversationForm(props.conversationMessage, true, {
        workflowCanSubmit: true,
        isSubmitting: false,
        readOnly: false,
        isCliInputDisabled: false,
      }),
    ],
  ]);
  return <ResolvedConversationMessage {...props} />;
};

describe("warning-severity system notice (real message body)", () => {
  beforeEach(() => {
    vi.mocked(useConversationContext).mockReturnValue({
      conversationTimeline: [],
      messages: [],
      resolvedForms: new Map(),
      workflowStatus: { canSubmit: true },
      isSubmitting: false,
      activeConversation: { id: "conv-1" },
      project: { id: "project-1", organizationId: "org-1" },
      animationType: "minimal",
      isReadOnly: false,
      handleRetrySuccess: vi.fn(),
    } as unknown as ReturnType<typeof useConversationContext>);
  });

  it("renders the notice text flat on the solid alert and keeps the System notice caption", async () => {
    const base = createMockConversationMessage();
    const conversationMessage = createMockConversationMessage({
      message: {
        ...base.message,
        id: "msg-1",
        type: MessageType.System,
        data: {
          type: "AGENT",
          response: "Execution is blocked.",
          presentation: "notice",
          noticeSeverity: "warning",
        } as never,
      },
    });

    render(
      <MemoryRouter>
        <ThemeProvider theme={createHeyTheme("light")}>
          <ConversationMessage
            conversationMessage={conversationMessage}
            messageIndex={0}
            totalMessages={1}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    const alert = screen.getByRole("status");
    const bubble = within(alert).getByTestId("system-message-AGENT");
    const style = getComputedStyle(bubble);

    await waitFor(() =>
      expect(alert).toHaveTextContent("Execution is blocked."),
    );
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.borderTopStyle).not.toBe("solid");
    expect(style.boxShadow).toBe("none");
    expect(style.minHeight).not.toBe("80px");
    expect(screen.getByTestId("notice-caption-msg-1")).toHaveTextContent(
      "System notice",
    );
  });

  it("keeps external and source-file links on the alert's foreground color, not the bubble's white", async () => {
    const base = createMockConversationMessage();
    const conversationMessage = createMockConversationMessage({
      message: {
        ...base.message,
        id: "msg-1",
        type: MessageType.System,
        data: {
          type: "AGENT",
          response:
            "See [the docs](https://example.com/docs) and [the file](/Users/zac/project/file.ts:42).",
          presentation: "notice",
          noticeSeverity: "warning",
        } as never,
      },
    });

    render(
      <MemoryRouter>
        <ThemeProvider theme={createHeyTheme("light")}>
          <ConversationMessage
            conversationMessage={conversationMessage}
            messageIndex={0}
            totalMessages={1}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    const alert = screen.getByRole("status");

    await waitFor(() => {
      const links = [
        within(alert).getByRole("link", { name: "the docs" }),
        within(alert).getByTestId("system-message-source-link"),
      ];
      const bubble = within(alert).getByTestId("system-message-AGENT");

      expect(
        getComputedStyle(bubble).getPropertyValue(
          "--system-message-link-color",
        ),
      ).toBe("currentcolor");
      for (const link of links) {
        expect(bubble).toContainElement(link);
        expect(link.style.color).toContain("var(--system-message-link-color");
      }
    });
  });

  it.each(["light", "dark"] as const)(
    "gives fenced and inline code a fill that keeps the alert foreground readable in %s mode",
    async (mode) => {
      const base = createMockConversationMessage();
      const conversationMessage = createMockConversationMessage({
        message: {
          ...base.message,
          id: "msg-1",
          type: MessageType.System,
          data: {
            type: "AGENT",
            response: "Run `pnpm test`:\n\n```\nconst a = 1;\n```",
            presentation: "notice",
            noticeSeverity: "warning",
          } as never,
        },
      });

      render(
        <MemoryRouter>
          <ThemeProvider theme={createHeyTheme(mode)}>
            <ConversationMessage
              conversationMessage={conversationMessage}
              messageIndex={0}
              totalMessages={1}
            />
          </ThemeProvider>
        </MemoryRouter>,
      );

      const alert = screen.getByRole("status");

      await waitFor(
        () => {
          const bubble = within(alert).getByTestId("system-message-AGENT");
          const pre = alert.querySelector("pre");
          const inline = alert.querySelector("p code");
          const bubbleStyle = getComputedStyle(bubble);

          expect(pre).not.toBeNull();
          expect(inline).not.toBeNull();
          expect(bubble).toContainElement(pre as HTMLElement);
          expect(bubble).toContainElement(inline as HTMLElement);
          // The fills code reads are the shaded-amber ones, not the bubble's
          // dark-mode greys that sit under the alert's dark text.
          expect(
            bubbleStyle.getPropertyValue("--system-message-code-block-bg"),
          ).toBe("rgba(0, 0, 0, 0.12)");
          expect(
            bubbleStyle.getPropertyValue("--system-message-inline-code-bg"),
          ).toBe("rgba(0, 0, 0, 0.12)");
        },
        { timeout: 5000 },
      );
    },
  );
});
