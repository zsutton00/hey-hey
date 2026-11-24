import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeWalkthroughReportPayload } from "../../../api";
import { ChangeWalkthroughReport } from "./ChangeWalkthroughReport";

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

const hookMocks = vi.hoisted(() => ({
  workItems: new Map<string, unknown>(),
  edges: [] as unknown[],
}));

const fetched = <T,>(data: T | null) => ({
  data,
  workItem: data,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
});

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (_org: string, _type: string, id: string) =>
    fetched(hookMocks.workItems.get(id) ?? null),
}));

vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: () => fetched({ relationships: hookMocks.edges }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({
    ...fetched(null),
    workItemTypeDefinition: undefined,
    workItemTypeSummary: undefined,
  }),
}));

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: ({
    anchorEl,
    entityId,
  }: {
    anchorEl: HTMLElement | null;
    entityId: string;
  }) =>
    anchorEl ? (
      <div data-testid="entity-hover-card" data-entity-id={entityId} />
    ) : null,
}));

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const DIAGRAM_ID = "00000000-0000-4000-8000-0000000000d1";
const ARCHIVED_DIAGRAM_ID = "00000000-0000-4000-8000-0000000000d2";
const report = { organizationId: ORG_ID, projectId: PROJECT_ID } as never;

const diagramElement = (id: string, name: string, diagramId = DIAGRAM_ID) => ({
  id,
  name,
  type: "DIAGRAM_ELEMENT",
  status: "ACTIVE",
  parentTaskId: diagramId,
  sections: [
    {
      key: "diagramElementMetadata",
      materializedMarkdown: JSON.stringify({ role: "SOFTWARE_SYSTEM" }),
    },
  ],
});

const linkEdge = (elementId: string, index: number) => ({
  id: `edge-${elementId}-${index}`,
  type: "FULFILLED_BY",
  category: "META",
  sourceNodeId: elementId,
  targetNodeId: `00000000-0000-4000-8000-00000000f${index}00`,
  targetEntityType: "TASK",
  targetNodeType: "STANDARD",
  targetNodeName: `Linked task ${index}`,
});

const elementId = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;

const withRefs = (ids: string[]) => ({
  ...payload,
  parts: [
    {
      name: "transition-service",
      role: "Moves a message between delivery states.",
      relations: "Called by the mail delivery service.",
      diagramElementRefs: ids.map((diagramElementId) => ({ diagramElementId })),
    },
  ],
});

const payload = {
  reportType: "CHANGE_WALKTHROUGH",
  summary:
    "The Run made session metadata reliable.\n\n- **resolveAgentSessionMetadata** (`metadata.ts`): reads session data.",
  targetRunId: "11111111-1111-4111-8111-111111111111",
  groups: [
    {
      title: "Metadata",
      changes: [
        {
          title: "Resolve metadata",
          context: "Called by **the launcher**.",
          walkthrough: [],
          behavioralConsequence: "Sessions start with metadata.",
        },
      ],
    },
  ],
} satisfies ChangeWalkthroughReportPayload;

describe("ChangeWalkthroughReport", () => {
  it("sends the summary and change prose through the Markdown renderer", () => {
    render(<ChangeWalkthroughReport payload={payload} />);

    const rendered = screen
      .getAllByTestId("markdown")
      .map((n) => n.textContent);
    expect(rendered).toContain(payload.summary);
    expect(rendered).toContain("Called by **the launcher**.");
    expect(rendered).toContain("Sessions start with metadata.");
  });

  it("shows a headed parts section before the change groups", () => {
    render(
      <ChangeWalkthroughReport
        payload={{
          ...payload,
          parts: [
            {
              name: "transition-service",
              role: "Moves a message between delivery states.",
              relations: "Called by the mail delivery service.",
            },
          ],
        }}
      />,
    );

    const parts = screen.getByTestId("walkthrough-parts");
    const group = screen.getByTestId("walkthrough-group");
    expect(parts).toHaveTextContent("Parts of the system");
    expect(screen.getByTestId("walkthrough-part")).toHaveTextContent(
      "transition-service",
    );
    expect(parts).toHaveTextContent("Moves a message between delivery states.");
    expect(parts).toHaveTextContent("Called by the mail delivery service.");
    expect(
      parts.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders older reports saved without parts and shows no parts section", () => {
    render(<ChangeWalkthroughReport payload={payload} />);

    expect(screen.getByTestId("walkthrough-group")).toBeInTheDocument();
    expect(screen.queryByTestId("walkthrough-parts")).not.toBeInTheDocument();
  });

  describe("Diagram Elements on parts", () => {
    beforeEach(() => {
      hookMocks.workItems.clear();
      hookMocks.edges = [];
      hookMocks.workItems.set(DIAGRAM_ID, {
        id: DIAGRAM_ID,
        name: "Outbound mail flow",
        type: "DIAGRAM",
        status: "ACTIVE",
      });
      hookMocks.workItems.set(ARCHIVED_DIAGRAM_ID, {
        id: ARCHIVED_DIAGRAM_ID,
        name: "Old flow",
        type: "DIAGRAM",
        status: "ARCHIVED",
      });
    });

    it("shows each referenced element with its Diagram and link icons, and opens a preview from an icon", () => {
      hookMocks.workItems.set(
        elementId(1),
        diagramElement(elementId(1), "Advance delivery state"),
      );
      hookMocks.edges = [1, 2, 3].map((n) => linkEdge(elementId(1), n));

      render(
        <ChangeWalkthroughReport
          report={report}
          reportTestId="report"
          payload={withRefs([elementId(1)])}
        />,
      );

      const row = screen.getByTestId("walkthrough-part-diagram-elements");
      expect(row).toHaveTextContent("In the design");
      const card = within(row).getByTestId("diagram-element-reference");
      expect(card).toHaveTextContent("Advance delivery state");
      expect(card).toHaveTextContent(
        "@[task:" + DIAGRAM_ID + "|Outbound mail flow]",
      );
      expect(
        within(card).getAllByTestId("diagram-element-direct-link"),
      ).toHaveLength(2);
      expect(
        within(card).getByTestId("diagram-element-reference-more-links"),
      ).toHaveTextContent("+1");

      fireEvent.click(
        within(card).getByRole("button", {
          name: "Preview Linked task 1; Fulfilled by",
        }),
      );
      expect(screen.getByTestId("entity-hover-card")).toHaveAttribute(
        "data-entity-id",
        "00000000-0000-4000-8000-00000000f100",
      );
    });

    it("omits references that no longer resolve and still renders the others", () => {
      hookMocks.workItems.set(
        elementId(1),
        diagramElement(elementId(1), "Advance delivery state"),
      );
      hookMocks.workItems.set(elementId(2), {
        ...diagramElement(elementId(2), "Retired step"),
        status: "ARCHIVED",
      });
      hookMocks.workItems.set(
        elementId(3),
        diagramElement(
          elementId(3),
          "In archived diagram",
          ARCHIVED_DIAGRAM_ID,
        ),
      );
      hookMocks.workItems.set(elementId(4), {
        ...diagramElement(elementId(4), "Not an element"),
        type: "STANDARD",
      });

      render(
        <ChangeWalkthroughReport
          report={report}
          reportTestId="report"
          payload={withRefs([
            elementId(1),
            elementId(2),
            elementId(3),
            elementId(4),
            elementId(5),
          ])}
        />,
      );

      const cards = screen.getAllByTestId("diagram-element-reference");
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent("Advance delivery state");
      expect(screen.getByTestId("walkthrough-group")).toBeInTheDocument();
    });

    it("collapses elements beyond three behind a Show more control", () => {
      const ids = [1, 2, 3, 4, 5].map(elementId);
      ids.forEach((id, index) =>
        hookMocks.workItems.set(id, diagramElement(id, `Element ${index + 1}`)),
      );

      render(
        <ChangeWalkthroughReport
          report={report}
          reportTestId="report"
          payload={withRefs(ids)}
        />,
      );

      expect(screen.getAllByTestId("diagram-element-reference")).toHaveLength(
        3,
      );
      fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
      expect(screen.getAllByTestId("diagram-element-reference")).toHaveLength(
        5,
      );
    });

    it("shows nothing extra for a part with an empty reference list", () => {
      render(
        <ChangeWalkthroughReport
          report={report}
          reportTestId="report"
          payload={withRefs([])}
        />,
      );

      expect(screen.getByTestId("walkthrough-part")).toBeInTheDocument();
      expect(
        screen.queryByTestId("walkthrough-part-diagram-elements"),
      ).not.toBeInTheDocument();
    });
  });
});
