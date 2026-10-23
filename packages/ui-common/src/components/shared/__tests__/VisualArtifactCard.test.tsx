import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextRelatedEntityDto } from "../../../api";
import { PreviewHostProvider } from "../../../contexts/PreviewHostContext";
import { VisualArtifactCard } from "../VisualArtifactCard";
import { selectVisualArtifacts } from "../visualArtifacts";

const mockUseWorkItem = vi.fn();
const mockUseWorkItemTypeByKey = vi.fn();
const mockOpenPreview = vi.fn();

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (...args: unknown[]) => mockUseWorkItem(...args),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: (...args: unknown[]) =>
    mockUseWorkItemTypeByKey(...args),
}));

vi.mock("../../Card", () => ({
  Card: ({
    title,
    children,
    dataTestId,
  }: {
    title: string;
    children: React.ReactNode;
    dataTestId: string;
  }) => (
    <section data-testid={dataTestId}>
      <h3>{title}</h3>
      {children}
    </section>
  ),
}));

vi.mock("../DiagramThumbnail", () => ({
  DiagramThumbnail: ({ diagramId }: { diagramId: string }) => (
    <div data-testid="diagram-thumbnail" data-diagram-id={diagramId} />
  ),
}));

vi.mock("../HtmlCssSectionThumbnail", () => ({
  HtmlCssSectionThumbnail: ({
    content,
    definition,
  }: {
    content: string;
    definition: { key: string };
  }) => (
    <div
      data-testid="html-css-thumbnail"
      data-section-key={definition.key}
      data-content={content}
    />
  ),
}));

vi.mock("../StructuredMockupSectionThumbnail", () => ({
  StructuredMockupSectionThumbnail: ({
    definition,
  }: {
    definition: { key: string };
  }) => (
    <div
      data-testid="structured-mockup-thumbnail"
      data-section-key={definition.key}
    />
  ),
}));

let intersect: (isIntersecting: boolean) => void = () => undefined;

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersect = (isIntersecting) =>
      callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      );
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

describe("VisualArtifactCard", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    mockOpenPreview.mockReset();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 280,
    } as DOMRect);
    mockUseWorkItem.mockReturnValue({
      workItem: {
        name: "Login",
        sections: [
          { key: "notes", content: "markdown notes" },
          { key: "screen", content: "<main />" },
        ],
      },
      isFetched: true,
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      isFetched: true,
      workItemTypeDefinition: {
        sections: [
          { key: "notes", kind: "markdown" },
          { key: "screen", kind: "html/css" },
        ],
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderCard = (typeKey: string) =>
    render(
      <PreviewHostProvider host={{ openPreview: mockOpenPreview }}>
        <VisualArtifactCard
          artifact={{ entityId: "artifact-1", typeKey, displayName: "Login" }}
          organizationId="org-1"
          projectId="project-1"
        />
      </PreviewHostProvider>
    );

  it("defers loading until the card nears the viewport", () => {
    renderCard("mockup");

    expect(
      screen.getByTestId("visual-artifact-card-artifact-1-preview")
    ).toHaveAttribute("data-load-state", "deferred");
    expect(screen.getByTestId("visual-artifact-card-loading")).toBeVisible();
    expect(mockUseWorkItem).not.toHaveBeenCalled();
    expect(screen.getByTestId("visual-artifact-card-artifact-1-preview")).toHaveStyle({ minHeight: "180px" });
  });

  it("renders the mockup section chosen by kind, not by key", () => {
    renderCard("mockup");
    act(() => intersect(true));

    const thumbnail = screen.getByTestId("html-css-thumbnail");
    expect(thumbnail).toHaveAttribute("data-section-key", "screen");
    expect(thumbnail).toHaveAttribute("data-content", "<main />");
  });

  it("renders structured mockups with the structured thumbnail", () => {
    mockUseWorkItemTypeByKey.mockReturnValue({
      isFetched: true,
      workItemTypeDefinition: {
        sections: [{ key: "screen", kind: "structured-mockup" }],
      },
    });
    renderCard("mockup");
    act(() => intersect(true));

    expect(
      screen.getByTestId("structured-mockup-thumbnail")
    ).toBeInTheDocument();
  });

  it("renders a diagram thumbnail for Diagrams", () => {
    renderCard("DIAGRAM");
    act(() => intersect(true));

    expect(screen.getByTestId("diagram-thumbnail")).toHaveAttribute(
      "data-diagram-id",
      "artifact-1"
    );
  });

  it.each(["html/css", "structured-mockup"])(
    "shows purpose below a %s preview using the existing lazy request",
    (kind) => {
      mockUseWorkItem.mockReturnValue({
        workItem: {
          name: "Login",
          sections: [
            { key: "screen", content: "<main />" },
            { key: "description", content: "Unused description" },
            {
              key: "purpose",
              content: "Show **sign-in** for @[feature:example|Account Management].",
            },
          ],
        },
        isFetched: true,
      });
      mockUseWorkItemTypeByKey.mockReturnValue({
        isFetched: true,
        workItemTypeDefinition: { sections: [{ key: "screen", kind }] },
      });
      renderCard("mockup");
      expect(screen.queryByTestId("mockup-purpose")).not.toBeInTheDocument();
      act(() => intersect(true));

      const purpose = screen.getByTestId("mockup-purpose");
      expect(purpose).toHaveTextContent("Show sign-in for Account Management.");
      expect(screen.queryByText("Unused description")).not.toBeInTheDocument();
      expect(purpose).toHaveStyle({
        display: "-webkit-box",
        WebkitLineClamp: "3",
        overflow: "hidden",
      });
      const thumbnail = screen.getByTestId(
        kind === "html/css" ? "html-css-thumbnail" : "structured-mockup-thumbnail"
      );
      expect(thumbnail.compareDocumentPosition(purpose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(mockUseWorkItem.mock.calls.every((args) => args[2] === "artifact-1")).toBe(true);
    }
  );

  it("adds no caption when the mockup has no purpose", () => {
    renderCard("mockup");
    act(() => intersect(true));
    expect(screen.queryByTestId("mockup-purpose")).not.toBeInTheDocument();
  });

  it.each(["mockup", "DIAGRAM"])(
    "opens a %s in Preview instead of navigating",
    (typeKey) => {
      renderCard(typeKey);
      const open = screen.getByTestId("visual-artifact-card-artifact-1-open");

      expect(open).not.toHaveAttribute("href");
      fireEvent.click(open);
      expect(mockOpenPreview).toHaveBeenCalledWith({
        entityType: "task",
        entityId: "artifact-1",
      });
    }
  );

  it("keeps the shared card title on one truncated line", () => {
    renderCard("DIAGRAM");
    expect(screen.getByRole("heading", { name: "Login" })).toHaveStyle({
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
  });
});

const related = (
  entityId: string,
  taskType: string,
  relationship = "related-to",
  entityType = "TASK"
): ContextRelatedEntityDto =>
  ({
    entityId,
    entityType,
    displayName: entityId,
    relationship,
    taskType,
  } as ContextRelatedEntityDto);

describe("selectVisualArtifacts", () => {
  it("lists structural children first, then linked artifacts, each once", () => {
    const artifacts = selectVisualArtifacts(
      [
        { id: "child-diagram", type: "DIAGRAM", name: "Child Diagram" },
        { id: "child-task", type: "STANDARD", name: "Child Task" },
        { id: "shared", type: "mockup", name: "Shared Mockup" },
      ],
      [
        related("linked-mockup", "mockup"),
        related("shared", "mockup", "depends-on"),
        related("linked-mockup", "mockup", "mentions"),
        related("linked-task", "STANDARD"),
      ]
    );

    expect(artifacts.map((artifact) => artifact.entityId)).toEqual([
      "child-diagram",
      "shared",
      "linked-mockup",
    ]);
  });

  it("ignores parent, sibling, workflow-flow, and non-task rows", () => {
    const artifacts = selectVisualArtifacts(
      [],
      [
        related("parent", "DIAGRAM", "parent"),
        related("sibling", "mockup", "sibling-via-parent"),
        related("flow", "DIAGRAM", "standard"),
        related("doc", "mockup", "related-to", "DESIGN_DOC"),
      ]
    );

    expect(artifacts).toEqual([]);
  });

  it("does not cap the number of artifacts", () => {
    const relatedEntities = Array.from({ length: 12 }, (_, index) =>
      related(`mockup-${index}`, "mockup")
    );
    expect(selectVisualArtifacts([], relatedEntities)).toHaveLength(12);
  });
});
