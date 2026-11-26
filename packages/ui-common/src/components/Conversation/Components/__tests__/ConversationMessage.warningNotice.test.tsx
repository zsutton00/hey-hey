import type React from "react";
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHeyTheme } from "../../../../contexts/ThemeContext";
import {
  MessageType,
  ReportAudience,
  ReportType,
  type ReportDto,
} from "../../../../api";
import { InterstitialThought } from "../../../LlmForms/Registry/InterstitialField";
import { SystemMessage } from "../SystemMessage";
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

// Shaped like the report a coding turn saves.
const implementReport: ReportDto = {
  id: "report-1",
  organizationId: "org-1",
  projectId: "project-1",
  reportType: ReportType.Implement,
  audience: ReportAudience.ProjectVisible,
  title: "Implementation report",
  payload: {
    reportType: "IMPLEMENT",
    summary: "Open completed the requested work.",
    filesChanged: ["apps/cli/src/server/task-monitor-start.ts"],
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-1",
  createdAt: "2026-11-24T00:00:00.000Z",
  expiresAt: "2026-12-24T00:00:00.000Z",
  entities: [],
};

describe("agent final reply (real message body)", () => {
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

  const renderAgentMessage = async (
    mode: "light" | "dark",
    data: Record<string, unknown>,
  ) => {
    const base = createMockConversationMessage();
    const conversationMessage = createMockConversationMessage({
      message: {
        ...base.message,
        id: "msg-1",
        type: MessageType.System,
        data: {
          type: "AGENT",
          response: "Run this:\n\n```\nconst a = 1;\n```",
          ...data,
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

    const shell = await screen.findByTestId(/^system-message-/);
    await waitFor(() => expect(shell.querySelector("pre")).not.toBeNull());
    return {
      shell,
      codeBlock: shell.querySelector("pre") as HTMLElement,
      blockCode: shell.querySelector("pre code") as HTMLElement,
    };
  };

  it.each([
    ["light", "rgb(241, 242, 244)", "#f1f2f4"],
    ["dark", "rgb(42, 42, 42)", "#2a2a2a"],
  ] as const)(
    "sits on the %s gray, with an outlined code block in the same gray",
    async (mode, gray, grayHex) => {
      const { shell, codeBlock, blockCode } = await renderAgentMessage(
        mode,
        {},
      );
      const style = getComputedStyle(shell);

      expect(style.backgroundColor).toBe(gray);
      expect(style.borderTopStyle).not.toBe("solid");
      expect(style.boxShadow).toBe("none");
      expect(style.borderRadius).not.toBe("");
      // The fill is an overridable variable, which jsdom leaves unresolved.
      expect(getComputedStyle(codeBlock).backgroundColor).toContain(grayHex);
      expect(getComputedStyle(codeBlock).borderTopStyle).toBe("solid");
      expect(getComputedStyle(blockCode).backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
    },
  );

  it("fades a completed reply's content and keeps its gray at full strength", async () => {
    const { shell } = await renderAgentMessage("light", {});

    expect(getComputedStyle(shell).opacity).not.toBe("0.7");
    expect(getComputedStyle(shell.firstElementChild!).opacity).toBe("0.7");
  });

  it.each([
    ["a Session Monitor message", { type: "SESSION_MONITOR" }],
    ["an informational system notice", { presentation: "notice" }],
  ])("leaves %s on its own treatment", async (_label, data) => {
    const theme = createHeyTheme("light");
    const { shell, codeBlock } = await renderAgentMessage("light", data);

    expect(getComputedStyle(shell).backgroundColor).not.toBe(
      "rgb(241, 242, 244)",
    );
    expect(getComputedStyle(shell).borderTopStyle).toBe("solid");
    expect(getComputedStyle(shell).opacity).toBe("0.7");
    expect(shell).toHaveStyle({ color: theme.palette.text.primary });
    expect(getComputedStyle(codeBlock).borderTopStyle).not.toBe("solid");
  });

  it.each(["light", "dark"] as const)(
    "outlines a report card when the reply has a report and no text in %s mode",
    (mode) => {
      render(
        <MemoryRouter>
          <ThemeProvider theme={createHeyTheme(mode)}>
            <SystemMessage
              animationType="minimal"
              type="AGENT"
              inlineReports={[implementReport]}
            />
          </ThemeProvider>
        </MemoryRouter>,
      );

      const card = screen.getByTestId("system-message-inline-report");
      const shell = screen.getByTestId("system-message-AGENT");
      const viewer = screen.getByTestId("report-viewer-report-1");

      expect(getComputedStyle(viewer).borderTopStyle).not.toBe("solid");
      expect(getComputedStyle(card).borderTopStyle).toBe("solid");
      expect(getComputedStyle(card).backgroundColor).toBe(
        getComputedStyle(shell).backgroundColor,
      );
    },
  );

  it("keeps thinking narration plain and muted, without fill or outlines", async () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={createHeyTheme("light")}>
          <InterstitialThought
            isActive={false}
            messageType="AGENT"
            position="only"
            thought={"Reading:\n\n```\nconst a = 1;\n```"}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    const shell = screen.getByTestId("system-message-AGENT");
    await waitFor(() => expect(shell.querySelector("pre")).not.toBeNull());
    const style = getComputedStyle(shell);

    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.borderTopStyle).not.toBe("solid");
    expect(style.boxShadow).toBe("none");
    // jsdom resolves neither theme variables nor `inherit`: the shell takes
    // the muted token and the text takes the shell's color.
    expect(style.color).toContain("text-secondary");
    expect(getComputedStyle(shell.querySelector("p")!).color).toBe("inherit");
    expect(
      getComputedStyle(shell.querySelector("pre")!).borderTopStyle,
    ).not.toBe("solid");
  });
});

const relativeLuminance = (color: string): number => {
  const channels = color
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Unparseable color: ${color}`);
  }
  const [r, g, b] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (foreground: string, background: string): number => {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

describe("your message text (real Markdown renderer)", () => {
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

  it.each(["light", "dark"] as const)(
    "keeps paragraphs, headings, quotes and links readable on the blue bubble in %s mode",
    async (mode) => {
      const base = createMockConversationMessage();
      const conversationMessage = createMockConversationMessage({
        message: {
          ...base.message,
          id: "user-msg-1",
          type: MessageType.User,
          data: {
            comment: [
              "## Plan check",
              "",
              "Please swap the colors.",
              "",
              "> Keep monitor messages neutral.",
              "",
              "See [the mockup](https://example.com/mockup).",
            ].join("\n"),
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

      const bubble = screen.getByTestId("user-message-user-msg-1");
      const bubbleBackground = getComputedStyle(bubble).backgroundColor;
      const rendered = await waitFor(() => {
        const elements = [
          within(bubble).getByText("Please swap the colors."),
          within(bubble).getByRole("heading", { name: "Plan check" }),
          within(bubble).getByText("Keep monitor messages neutral."),
          within(bubble).getByRole("link", { name: "the mockup" }),
        ];
        return elements;
      });

      for (const element of rendered) {
        const color = getComputedStyle(element).color;
        expect(
          contrastRatio(color, bubbleBackground),
          `${element.tagName} ${color} on ${bubbleBackground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
