import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentChips } from "../AttachmentChips";

describe("AttachmentChips", () => {
  it("removes the attachment row when empty, including after removing the last file", () => {
    const remove = vi.fn();
    const { container, rerender } = render(
      <AttachmentChips attachments={{ entries: [], remove }} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <AttachmentChips
        attachments={{
          entries: [{ key: "file", fileName: "notes.txt", status: "uploading" }],
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
});
