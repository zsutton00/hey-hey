import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRunAttachmentOpenError } from "../../../AgentSession/runtime/directoryBindingApi";
import { SentAttachmentChips } from "../UserMessageBubble";

const openRunAttachment = vi.hoisted(() => vi.fn());
const useTarget = vi.hoisted(() => vi.fn());

vi.mock(
  "../../../AgentSession/runtime/directoryBindingApi",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../../../AgentSession/runtime/directoryBindingApi")
      >();
    return {
      ...original,
      resolveLocalDirectoryRuntimeBaseUrl: () => "http://localhost:3847",
      createDirectoryBindingApi: () => ({ openRunAttachment }),
    };
  },
);
vi.mock("../SentAttachmentOpenContext", () => ({
  useSentAttachmentOpenTarget: useTarget,
}));

const attachments = [
  { attachmentId: "a1", fileName: "photo.png" },
  { attachmentId: "a2", fileName: "run.sh" },
];

describe("SentAttachmentChips", () => {
  beforeEach(() => {
    useTarget.mockReturnValue({ runId: "run-1", machineId: "machine-1" });
    openRunAttachment.mockResolvedValue({});
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders button chips whose accessible name includes the file name", () => {
    render(<SentAttachmentChips attachments={attachments} />);

    expect(
      screen.getByRole("button", { name: /photo\.png/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run\.sh/ })).toBeInTheDocument();
  });

  it("makes one request for the clicked chip with the target's Run and machine", async () => {
    render(<SentAttachmentChips attachments={attachments} />);

    fireEvent.click(screen.getByRole("button", { name: /run\.sh/ }));

    await waitFor(() => expect(openRunAttachment).toHaveBeenCalledOnce());
    expect(openRunAttachment).toHaveBeenCalledWith(
      "run-1",
      "a2",
      "machine-1",
      "run.sh",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("blocks further clicks while a request is in flight", async () => {
    let release!: () => void;
    openRunAttachment.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    render(<SentAttachmentChips attachments={attachments} />);

    fireEvent.click(screen.getByRole("button", { name: /photo\.png/ }));
    fireEvent.click(screen.getByRole("button", { name: /photo\.png/ }));
    fireEvent.click(screen.getByRole("button", { name: /run\.sh/ }));

    expect(openRunAttachment).toHaveBeenCalledOnce();
    release();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /run\.sh/ }),
      ).not.toHaveAttribute("aria-disabled", "true"),
    );
  });

  it.each([
    [
      "the file is gone",
      new LocalRunAttachmentOpenError("gone", "ATTACHMENT_NOT_FOUND"),
    ],
    [
      "no opener exists",
      new LocalRunAttachmentOpenError("none", "OPENER_UNAVAILABLE"),
    ],
    ["the CLI replied untyped", new LocalRunAttachmentOpenError("bad", null)],
    ["the CLI is unreachable", new TypeError("Failed to fetch")],
  ])(
    "shows one unavailable notice when %s, without retrying",
    async (_name, error) => {
      openRunAttachment.mockRejectedValue(error);
      render(<SentAttachmentChips attachments={attachments} />);

      fireEvent.click(screen.getByRole("button", { name: /photo\.png/ }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Attachment unavailable",
      );
      expect(openRunAttachment).toHaveBeenCalledOnce();
      expect(screen.getAllByTestId("sent-attachment-chip")).toHaveLength(2);
    },
  );

  it("clears the notice when a later click succeeds", async () => {
    openRunAttachment.mockRejectedValueOnce(new TypeError("offline"));
    render(<SentAttachmentChips attachments={attachments} />);

    fireEvent.click(screen.getByRole("button", { name: /photo\.png/ }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: /photo\.png/ }));

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(openRunAttachment).toHaveBeenCalledTimes(2);
  });

  it("keeps chips inert without a target", () => {
    useTarget.mockReturnValue(null);
    render(<SentAttachmentChips attachments={attachments} />);

    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.click(screen.getAllByTestId("sent-attachment-chip")[0]);
    expect(openRunAttachment).not.toHaveBeenCalled();
  });

  it("renders nothing for a message without attachments", () => {
    const { container } = render(<SentAttachmentChips attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
