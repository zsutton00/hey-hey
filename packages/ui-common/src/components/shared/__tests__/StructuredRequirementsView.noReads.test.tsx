import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { StructuredRequirementsView } from "../StructuredRequirementsView";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { MentionBadgeInner } from "../../SmarterTextAreaCard/MentionBadge";
import { MentionEditorContext } from "../../SmarterTextAreaCard/EditorContext";
import type { FeatureRequirementRecord } from "../../../utils/structuredRequirements";

const useWorkItemSpy = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => ({ workItem: undefined }))
);

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: useWorkItemSpy,
}));

vi.mock("../../../data/hooks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useWorkItem: useWorkItemSpy,
}));

// Registry fixture: every mentioned kind resolves to a type that does not
// render inline, so expanded mentions must stay token-only badges.
vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMentionWorkItemTypeKey: (
    _organizationId: string | undefined,
    _projectId: string | undefined,
    kind: string | undefined
  ) => ({ typeKey: kind?.toUpperCase(), isResolved: kind !== undefined }),
  useWorkItemTypeByKey: (
    _organizationId: string | undefined,
    _projectId: string | undefined,
    key: string | undefined
  ) => ({
    workItemTypeDefinition: key
      ? { key, name: key, capabilities: { rendersInline: false }, allowedStatuses: [], sections: [] }
      : undefined,
    isFetched: key !== undefined,
    error: null,
  }),
}));

const uuid = (last: string) => `00000000-0000-4000-8000-00000000000${last}`;

const requirements: FeatureRequirementRecord[] = [
  {
    id: uuid("1"),
    statement: "Renders without reads",
    designedBy: [
      { entityType: "MOCKUP", entityId: uuid("2"), entityTitle: "Badge mockup" },
      { entityType: "DESIGN_DOC", entityId: uuid("3"), entityTitle: "Badge doc" },
    ],
    fulfilledBy: [
      { entityType: "TASK", entityId: uuid("4"), entityTitle: "Badge task" },
    ],
    contracts: [],
  },
];

const wrap = (node: React.ReactNode) => (
  <MemoryRouter>
    <MentionEditorContext.Provider
      value={{ organizationId: "org-1", projectId: "project-1", navigate: vi.fn() }}
    >
      {node}
    </MentionEditorContext.Provider>
  </MemoryRouter>
);

const enabledWorkItemReads = () =>
  useWorkItemSpy.mock.calls.filter((call) => {
    const options = call[3] as { enabled?: boolean } | undefined;
    return options?.enabled !== false;
  });

describe("mention and citation rendering", () => {
  it("never reads referenced work items while rendering citations and description mentions", () => {
    render(
      wrap(
        <>
          <StructuredRequirementsView requirements={requirements} />
          <MentionBadgeInner
            mention={{ entityType: "task", entityId: uuid("5"), entityName: "Described task" }}
          />
        </>
      )
    );

    expect(screen.getByText("Badge mockup")).toBeInTheDocument();
    expect(screen.getByText("Badge task")).toBeInTheDocument();
    expect(screen.getByText("Described task")).toBeInTheDocument();
    expect(enabledWorkItemReads()).toEqual([]);
  });

  it("never reads mentioned work items in expanded description and requirement markdown", () => {
    const markdown = [
      `Builds on @[feature:${uuid("6")}|Open Items] and @[STANDARD:${uuid("7")}|Wire the rail].`,
      "",
      `- Must not regress @[BUG:${uuid("8")}|Badge flicker].`,
    ].join("\n");

    render(
      wrap(
        <MarkdownRenderer
          mentionConfig={{ organizationId: "org-1", projectId: "project-1" }}
        >
          {markdown}
        </MarkdownRenderer>
      )
    );

    expect(screen.getByText("Open Items")).toBeInTheDocument();
    expect(screen.getByText("Wire the rail")).toBeInTheDocument();
    expect(screen.getByText("Badge flicker")).toBeInTheDocument();
    expect(enabledWorkItemReads()).toEqual([]);
  });

  it("keeps the citation's own entity type", () => {
    render(wrap(<StructuredRequirementsView requirements={requirements} />));

    const mockupBadge = screen
      .getAllByTestId("mention-badge")
      .find((badge) => badge.getAttribute("data-entity-id") === uuid("2"));
    expect(mockupBadge).toHaveAttribute("data-entity-type", "MOCKUP");
  });
});
