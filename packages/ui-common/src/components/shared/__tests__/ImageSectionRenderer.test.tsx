import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageSectionRenderer } from "../ImageSectionRenderer";
import {
  IMAGE_SECTION_MAX_BYTES,
  IMAGE_SECTION_SCHEMA_REF,
  encodeImageFile,
  isImageSectionDefinition,
  readImageSection,
} from "../imageSection";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);
const PNG_BASE64 = btoa(String.fromCharCode(...PNG_BYTES));
const STORED = JSON.stringify({ mimeType: "image/png", data: PNG_BASE64 });

const file = (bytes: Uint8Array, type: string, name = "image") =>
  new File([bytes], name, { type });

describe("imageSection", () => {
  it("selects image rendering from kind and schemaRef, not type key", () => {
    expect(
      isImageSectionDefinition({ kind: "json", schemaRef: IMAGE_SECTION_SCHEMA_REF })
    ).toBe(true);
    expect(isImageSectionDefinition({ kind: "json" })).toBe(false);
    expect(
      isImageSectionDefinition({ kind: "markdown", schemaRef: IMAGE_SECTION_SCHEMA_REF })
    ).toBe(false);
  });

  it("reads absent, stored JSON text, proposed objects, and invalid values", () => {
    expect(readImageSection("")).toEqual({ status: "absent" });
    expect(readImageSection(undefined)).toEqual({ status: "absent" });
    expect(readImageSection(STORED).status).toBe("valid");
    expect(
      readImageSection({ mimeType: "image/png", data: PNG_BASE64 }).status
    ).toBe("valid");
    expect(readImageSection("{nope").status).toBe("invalid");
    expect(
      readImageSection({ mimeType: "image/gif", data: PNG_BASE64 }).status
    ).toBe("invalid");
  });

  it("encodes a valid file without altering its bytes", async () => {
    const result = await encodeImageFile(file(PNG_BYTES, "image/png"));
    expect(result).toEqual({
      status: "ok",
      image: { mimeType: "image/png", data: PNG_BASE64 },
    });
  });

  it("rejects oversized, unsupported, and mislabelled files", async () => {
    const oversized = new Uint8Array(IMAGE_SECTION_MAX_BYTES + 1);
    oversized.set(PNG_BYTES);
    expect((await encodeImageFile(file(oversized, "image/png"))).status).toBe(
      "error"
    );
    expect(
      (await encodeImageFile(file(new Uint8Array([0x47, 0x49, 0x46]), "image/gif")))
        .status
    ).toBe("error");
    expect((await encodeImageFile(file(PNG_BYTES, "image/jpeg"))).status).toBe(
      "error"
    );
  });
});

describe("ImageSectionRenderer", () => {
  it("shows an Upload control and drop target when the section is absent", () => {
    render(<ImageSectionRenderer content="" label="Screenshot" onChange={vi.fn()} />);
    expect(screen.getByTestId("image-section-dropzone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("emits canonical JSON when a valid file is uploaded", async () => {
    const onChange = vi.fn();
    render(<ImageSectionRenderer content="" label="Screenshot" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("image-section-file-input"), {
      target: { files: [file(PNG_BYTES, "image/png")] },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(STORED));
  });

  it("keeps existing content and explains the failure for an invalid file", async () => {
    const onChange = vi.fn();
    render(
      <ImageSectionRenderer content={STORED} label="Screenshot" onChange={onChange} />
    );
    fireEvent.change(screen.getByTestId("image-section-file-input"), {
      target: { files: [file(new Uint8Array([1, 2, 3]), "image/png")] },
    });
    expect(await screen.findByTestId("image-section-error")).toHaveTextContent(
      "PNG, JPEG, or WebP"
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("image-section-preview")).toBeInTheDocument();
  });

  it("offers Replace and Remove for a populated section; Remove returns absence", () => {
    const onChange = vi.fn();
    render(
      <ImageSectionRenderer content={STORED} label="Screenshot" onChange={onChange} />
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("renders read-only without editing controls or base64 text", () => {
    render(<ImageSectionRenderer content={STORED} label="Screenshot" />);
    expect(screen.getByTestId("image-section-preview")).toHaveAttribute(
      "alt",
      "Screenshot"
    );
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByText(PNG_BASE64)).toBeNull();
  });
});
