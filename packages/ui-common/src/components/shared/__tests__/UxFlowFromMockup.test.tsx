import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockupUxFlows } from "../UxFlowFromMockup";

const { flowsState, surfaceProps } = vi.hoisted(() => ({
  flowsState: {
    flows: [] as {
      diagramId: string;
      diagramName: string;
      elementId: string;
    }[],
  },
  surfaceProps: vi.fn(),
}));

vi.mock("../../../data/hooks/useUxFlowsForMockup", () => ({
  useUxFlowsForMockup: () => ({ flows: flowsState.flows, isLoading: false }),
}));
vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: () => ({
    data: {
      root: { id: "d1", type: "DIAGRAM", name: "Checkout" },
      children: [{ id: "el1", type: "DIAGRAM_ELEMENT", name: "Cart" }],
      relationships: [],
      participation: null,
      layout: null,
    },
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({
    isFetched: true,
    error: null,
    workItemTypeDefinition: undefined,
  }),
}));
vi.mock("../WorkflowMentionInlineRenderer", () => ({
  WorkflowGraphSurface: (props: { currentUxFlowStepId?: string }) => {
    surfaceProps(props);
    return <div data-testid="surface" />;
  },
}));

const renderFlows = () =>
  render(
    <MemoryRouter>
      <MockupUxFlows
        organizationId="org"
        projectId="project"
        mockupId="mockup"
      />
    </MemoryRouter>,
  );

describe("MockupUxFlows", () => {
  beforeEach(() => {
    surfaceProps.mockClear();
  });

  it("renders nothing for a Mockup that is in no UX flow", () => {
    flowsState.flows = [];
    const { container } = renderFlows();

    expect(container).toBeEmptyDOMElement();
  });

  it("heads the only flow with its title as a link to the full flow, with this screen marked", () => {
    flowsState.flows = [
      { diagramId: "d1", diagramName: "Checkout", elementId: "el1" },
    ];
    renderFlows();

    const title = screen.getByTestId("ux-flow-title-link");
    expect(title).toHaveTextContent("Checkout");
    expect(title.getAttribute("href")).toContain("d1");
    expect(screen.queryByText(/open flow/i)).toBeNull();
    expect(surfaceProps).toHaveBeenCalledWith(
      expect.objectContaining({ currentUxFlowStepId: "el1" }),
    );
  });

  it("shows each of several flows as its own titled block", () => {
    flowsState.flows = [
      { diagramId: "d1", diagramName: "Checkout", elementId: "el1" },
      { diagramId: "d2", diagramName: "Signup", elementId: "el2" },
    ];
    renderFlows();

    const blocks = screen.getAllByTestId("mockup-ux-flow");
    expect(blocks).toHaveLength(2);
    expect(
      within(blocks[0]).getByTestId("ux-flow-title-link"),
    ).toHaveTextContent("Checkout");
    expect(
      within(blocks[1]).getByTestId("ux-flow-title-link"),
    ).toHaveTextContent("Signup");
    expect(
      within(blocks[1]).getByTestId("ux-flow-title-link").getAttribute("href"),
    ).toContain("d2");
  });
});
