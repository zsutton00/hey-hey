import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SentAttachmentOpenProvider } from "../SentAttachmentOpenContext";
import { UserMessageBubble } from "../UserMessageBubble";
import { formatMessageTimestamp } from "../messageTimestamp";

const openRunAttachment = vi.hoisted(() => vi.fn());

vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({
    agentSession: {
      id: "session-1",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      machineId: "machine-1",
      status: "RUNNING",
    },
    error: null,
  }),
}));
vi.mock("../../../AgentSession/runtime/hooks/useLocalCliForSession", () => ({
  useLocalCliForSession: () => ({ status: "local", machineId: "machine-1" }),
}));
vi.mock(
  "../../../AgentSession/runtime/directoryBindingApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../AgentSession/runtime/directoryBindingApi")
    >()),
    createDirectoryBindingApi: () => ({ openRunAttachment }),
  }),
);
vi.mock("../../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
}));

describe("UserMessageBubble layout", () => {
  it("contains caption margins in the same layout when starting becomes delivered", () => {
    const createdAt = "2024-01-01T12:00:00Z";
    const message = (delivered: boolean) => (
      <MemoryRouter>
        <UserMessageBubble
          identity="message-1"
          data-testid="message-bubble"
          projectId="project-1"
          text="Please start the task"
          provenance={null}
          author={{ name: "Alice Smith", id: "user-1" }}
          createdAt={delivered ? createdAt : null}
          renderTimestamp={delivered}
          delivery={{ state: delivered ? "delivered" : "starting" }}
        />
      </MemoryRouter>
    );
    const { rerender } = render(message(false));
    const startingCaption = screen.getByTestId("message-timestamp-message-1");
    const startingStyle = getComputedStyle(startingCaption);
    const presentation = screen.getByTestId("user-message-presentation");
    // A block formatting context prevents the caption's bottom margin from
    // collapsing through the different preview and timeline ancestors.
    expect(presentation).toHaveStyle({ display: "flow-root" });
    expect(presentation).toContainElement(startingCaption);
    expect(presentation).toContainElement(screen.getByTestId("message-bubble"));
    expect(startingCaption).toHaveTextContent("Alice Smith · Starting…");

    rerender(message(true));

    const deliveredCaption = screen.getByTestId("message-timestamp-message-1");
    const deliveredStyle = getComputedStyle(deliveredCaption);
    expect(screen.getByTestId("user-message-presentation")).toBe(presentation);
    expect(deliveredCaption).toHaveTextContent(
      `Alice Smith · ${formatMessageTimestamp(createdAt)}`,
    );
    expect(screen.queryByText("Starting…")).not.toBeInTheDocument();
    for (const property of [
      "fontSize",
      "lineHeight",
      "marginTop",
      "marginBottom",
    ] as const) {
      expect(deliveredStyle[property]).toBe(startingStyle[property]);
    }
  });
});

describe("UserMessageBubble sent attachments", () => {
  const render_ = (
    attachments?: { attachmentId: string; fileName: string }[],
  ) =>
    render(
      <MemoryRouter>
        <UserMessageBubble
          identity="message-1"
          data-testid="message-bubble"
          projectId="project-1"
          text="See attached"
          provenance={null}
          author={null}
          createdAt={null}
          renderTimestamp={false}
          delivery={{ state: "delivered" }}
          attachments={attachments}
        />
      </MemoryRouter>,
    );

  it("shows one inert name chip per attachment", () => {
    render_([
      { attachmentId: "a1", fileName: "notes.md" },
      { attachmentId: "a2", fileName: "log.txt" },
    ]);
    const chips = screen.getAllByTestId("sent-attachment-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "notes.md",
      "log.txt",
    ]);
    for (const chip of chips) {
      expect(chip).not.toHaveAttribute("role", "button");
      expect(chip.querySelector("svg")).toBeNull();
    }
  });

  it("right-justifies the chip row below the bubble with a positive gap", () => {
    render_([{ attachmentId: "a1", fileName: "notes.md" }]);
    const section = screen.getByTestId("sent-attachments");
    const row = screen.getByTestId("sent-attachment-chip").parentElement;
    expect(row).toHaveStyle({ justifyContent: "flex-end" });
    expect(parseFloat(getComputedStyle(section).marginTop)).toBeGreaterThan(0);
  });

  it("adds no top gap when the message has no text", () => {
    render(
      <MemoryRouter>
        <UserMessageBubble
          identity="message-1"
          data-testid="message-bubble"
          projectId="project-1"
          text={null}
          provenance={null}
          author={null}
          createdAt={null}
          renderTimestamp={false}
          delivery={{ state: "delivered" }}
          attachments={[{ attachmentId: "a1", fileName: "notes.md" }]}
        />
      </MemoryRouter>,
    );
    const section = screen.getByTestId("sent-attachments");
    const row = screen.getByTestId("sent-attachment-chip").parentElement;
    expect(row).toHaveStyle({ justifyContent: "flex-end" });
    expect(parseFloat(getComputedStyle(section).marginTop || "0")).toBe(0);
  });

  it.each([undefined, []])("renders no chips for %j", (attachments) => {
    render_(attachments);
    expect(screen.queryByTestId("sent-attachments")).not.toBeInTheDocument();
  });
});

describe("UserMessageBubble sent attachments in one conversation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens a delivered message and a queued preview through the same target", async () => {
    openRunAttachment.mockResolvedValue({});
    const bubble = (
      identity: string,
      delivery: React.ComponentProps<typeof UserMessageBubble>["delivery"],
      attachmentId: string,
      fileName: string,
    ) => (
      <UserMessageBubble
        identity={identity}
        data-testid={`bubble-${identity}`}
        projectId="project-1"
        text={`Message ${identity}`}
        provenance={null}
        author={null}
        createdAt={null}
        renderTimestamp={false}
        delivery={delivery}
        attachments={[{ attachmentId, fileName }]}
      />
    );
    render(
      <MemoryRouter>
        <SentAttachmentOpenProvider
          organizationId="org-1"
          projectId="project-1"
          agentSessionId="session-1"
          conversationId="conversation-1"
        >
          {bubble("delivered", { state: "delivered" }, "a1", "photo.png")}
          {bubble(
            "queued",
            {
              state: "queued",
              cancelling: false,
              canCancel: true,
              onCancel: vi.fn(),
              error: null,
            },
            "a2",
            "notes.md",
          )}
        </SentAttachmentOpenProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /photo\.png/ }));
    await waitFor(() => expect(openRunAttachment).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /notes\.md/ }));
    await waitFor(() => expect(openRunAttachment).toHaveBeenCalledTimes(2));

    expect(openRunAttachment).toHaveBeenNthCalledWith(
      1,
      "session-1",
      "a1",
      "machine-1",
      "photo.png",
    );
    expect(openRunAttachment).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "a2",
      "machine-1",
      "notes.md",
    );
  });
});
