import { fireEvent, render, screen, within } from "@testing-library/react";
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
  WorkflowGraphSurface: (props: {
    initialUxFlowStepId?: string;
    currentUxFlowStepId?: string;
  }) => {
    surfaceProps(props);
    return <div data-testid="surface" />;
  },
}));

const renderFlows = () =>
  render(
    <MockupUxFlows
      organizationId="org"
      projectId="project"
      mockupId="mockup"
    />,
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

  it("shows the only flow inline with this screen marked and no old button", () => {
    flowsState.flows = [
      { diagramId: "d1", diagramName: "Checkout", elementId: "el1" },
    ];
    renderFlows();

    expect(screen.queryByTestId("open-in-ux-flow")).toBeNull();
    expect(screen.getByTestId("mockup-ux-flows")).toHaveTextContent(
      "Part of UX flow: Checkout",
    );
    expect(screen.getAllByTestId("mockup-ux-flow")).toHaveLength(1);
    expect(surfaceProps).toHaveBeenCalledWith(
      expect.objectContaining({ currentUxFlowStepId: "el1" }),
    );
    expect(surfaceProps).not.toHaveBeenCalledWith(
      expect.objectContaining({ initialUxFlowStepId: expect.anything() }),
    );
  });

  it("shows each of several flows as its own block with its own open link", () => {
    flowsState.flows = [
      { diagramId: "d1", diagramName: "Checkout", elementId: "el1" },
      { diagramId: "d2", diagramName: "Signup", elementId: "el2" },
    ];
    renderFlows();

    const blocks = screen.getAllByTestId("mockup-ux-flow");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveTextContent("Checkout");
    expect(blocks[1]).toHaveTextContent("Signup");
    expect(screen.getAllByTestId("open-ux-flow")).toHaveLength(2);

    surfaceProps.mockClear();
    fireEvent.click(within(blocks[1]).getByTestId("open-ux-flow"));

    expect(surfaceProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialUxFlowStepId: "el2" }),
    );
  });
});
