import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MaterializedDesignDocSection } from "../../../api";
import { DesignDocExportPanel } from "../DesignDocExportPanel";

const mockCollapseAction = vi.fn();
let capturedBlob: Blob | null = null;

vi.mock("../../ActionsCapsule", () => ({
  useActionsCapsule: () => ({
    collapseAction: mockCollapseAction,
  }),
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;
const mockCreateObjectURL = vi.fn((blob: Blob) => {
  capturedBlob = blob;
  return "blob:design-doc-export";
});
const mockRevokeObjectURL = vi.fn();
const mockAnchorClick = vi.fn();

const sections: MaterializedDesignDocSection[] = [
  {
    id: "section-1",
    key: "content",
    order: 0,
    materializedMarkdown: "Body content",
  },
];

const readBlobAsText = async (blob: Blob): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result ?? ""));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read blob"));
    };
    reader.readAsText(blob);
  });
};

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: mockCreateObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: mockRevokeObjectURL,
  });
  HTMLAnchorElement.prototype.click = mockAnchorClick;
});

beforeEach(() => {
  capturedBlob = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
  }

  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  }

  HTMLAnchorElement.prototype.click = originalAnchorClick;
});

describe("DesignDocExportPanel", () => {
  it("includes section headings by default", async () => {
    render(
      <DesignDocExportPanel
        title="Plan"
        summary="Summary"
        sections={sections}
        headerText="Export Plan"
        descriptionText="Download"
        buttonText="Download markdown"
        sectionTitles={{ content: "Content" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Download markdown" }));

    expect(capturedBlob).not.toBeNull();
    const markdownContent = await readBlobAsText(capturedBlob!);
    expect(markdownContent).toContain("## Content");

    await waitFor(() => {
      expect(mockCollapseAction).toHaveBeenCalledTimes(1);
    });
  });

  it("omits section headings when showSectionHeadings is false", async () => {
    render(
      <DesignDocExportPanel
        title="Plan"
        summary="Summary"
        sections={sections}
        headerText="Export Plan"
        descriptionText="Download"
        buttonText="Download markdown"
        sectionTitles={{ content: "Content" }}
        showSectionHeadings={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Download markdown" }));

    expect(capturedBlob).not.toBeNull();
    const markdownContent = await readBlobAsText(capturedBlob!);
    expect(markdownContent).not.toContain("## Content");
    expect(markdownContent).toContain("Body content");
  });
});
