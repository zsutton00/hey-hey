import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentChips } from "../AttachmentChips";
import type { RunAttachmentEntry } from "../runtime/hooks/runAttachmentDrop";

const ready = (file: File): RunAttachmentEntry => ({
  key: file.name,
  fileName: file.name,
  status: "ready",
  file,
  reference: { attachmentId: `id-${file.name}`, fileName: file.name },
});

const png = () =>
  new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
const ts = () => new File(["const answer = 42;"], "code.ts");

describe("AttachmentChips", () => {
  const createObjectURL = vi.fn(() => "blob:preview");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    // jsdom's Blob lacks text(); browsers provide it.
    Blob.prototype.text = function text(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  });

  it("removes the attachment row when empty, including after removing the last file", () => {
    const remove = vi.fn();
    const { container, rerender } = render(
      <AttachmentChips attachments={{ entries: [], remove }} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <AttachmentChips
        attachments={{
          entries: [
            {
              key: "file",
              fileName: "notes.txt",
              status: "uploading",
              file: new File(["x"], "notes.txt"),
            },
          ],
          remove,
        }}
      />,
    );
    expect(screen.getByTestId("run-attachments")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("remove-run-attachment"));
    expect(remove).toHaveBeenCalledWith("file");

    rerender(<AttachmentChips attachments={{ entries: [], remove }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a thumbnail for images and an icon for text, each removable without opening a preview", () => {
    const remove = vi.fn();
    render(
      <AttachmentChips
        attachments={{ entries: [ready(png()), ready(ts())], remove }}
      />,
    );
    const [image, text] = screen.getAllByTestId("run-attachment-chip");

    expect(
      within(image).getByTestId("run-attachment-thumbnail"),
    ).toBeInTheDocument();
    expect(within(text).getByTestId("run-attachment-icon")).toBeInTheDocument();
    expect(image).toHaveTextContent("shot.png");
    expect(text).toHaveTextContent("code.ts");

    fireEvent.click(within(text).getByTestId("remove-run-attachment"));
    expect(remove).toHaveBeenCalledWith("code.ts");
    expect(screen.queryByTestId("attachment-preview-dialog")).toBeNull();
  });

  it("keeps a reference-only chip's icon, name and remove control but offers no preview", () => {
    const remove = vi.fn();
    render(
      <AttachmentChips
        attachments={{
          entries: [
            {
              key: "gone",
              fileName: "gone.png",
              status: "ready",
              reference: { attachmentId: "id-gone", fileName: "gone.png" },
            },
          ],
          remove,
        }}
      />,
    );
    const chip = screen.getByTestId("run-attachment-chip");

    expect(within(chip).getByTestId("run-attachment-icon")).toBeInTheDocument();
    expect(chip).toHaveTextContent("gone.png");
    fireEvent.click(chip);
    expect(screen.queryByTestId("attachment-preview-dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Preview gone.png" }),
    ).toBeNull();
    fireEvent.click(within(chip).getByTestId("remove-run-attachment"));
    expect(remove).toHaveBeenCalledWith("gone");
  });

  it("opens a read-only preview and closes it without changing entries", async () => {
    const remove = vi.fn();
    render(
      <AttachmentChips attachments={{ entries: [ready(ts())], remove }} />,
    );

    fireEvent.click(screen.getByTestId("run-attachment-chip"));
    expect(
      await screen.findByTestId("attachment-preview-text"),
    ).toHaveTextContent("const answer = 42;");

    fireEvent.click(screen.getByTestId("attachment-preview-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("attachment-preview-dialog")).toBeNull(),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("run-attachment-chip")).toHaveLength(1);
  });

  it("falls back to Preview unavailable when the image fails to load", async () => {
    render(
      <AttachmentChips
        attachments={{ entries: [ready(png())], remove: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByTestId("run-attachment-chip"));
    fireEvent.error(await screen.findByTestId("attachment-preview-image"));

    expect(
      screen.getByTestId("attachment-preview-unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("remove-run-attachment")).toBeInTheDocument();
  });

  it("previews only the first 256 KiB of a large text file", async () => {
    const big = new File(["a".repeat(300 * 1024)], "big.log");
    render(
      <AttachmentChips
        attachments={{ entries: [ready(big)], remove: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByTestId("run-attachment-chip"));
    const pre = await screen.findByTestId("attachment-preview-text");

    expect(pre.textContent).toHaveLength(256 * 1024);
    expect(screen.getByText("Showing the first 256 KiB")).toBeInTheDocument();
  });

  it("shows Preview unavailable when the text cannot be read", async () => {
    const file = ts();
    vi.spyOn(file, "slice").mockReturnValue({
      text: () => Promise.reject(new Error("unreadable")),
    } as unknown as Blob);
    render(
      <AttachmentChips
        attachments={{ entries: [ready(file)], remove: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByTestId("run-attachment-chip"));

    expect(
      await screen.findByTestId("attachment-preview-unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("remove-run-attachment")).toBeInTheDocument();
  });

  it("revokes the image object URL when the chip goes away", () => {
    const { unmount } = render(
      <AttachmentChips
        attachments={{ entries: [ready(png())], remove: vi.fn() }}
      />,
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("keeps a failed upload's typed error and lets it be dismissed", () => {
    const remove = vi.fn();
    render(
      <AttachmentChips
        attachments={{
          entries: [
            {
              key: "bad",
              fileName: "bad.png",
              status: "error",
              message: "Too large",
              code: null,
            },
          ],
          remove,
        }}
      />,
    );

    expect(screen.getByTestId("run-attachment-error")).toHaveTextContent(
      "Too large",
    );
    fireEvent.click(screen.getByTestId("remove-run-attachment"));
    expect(remove).toHaveBeenCalledWith("bad");
  });
});
