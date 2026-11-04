import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenInUxFlowButton } from "../UxFlowFromMockup";

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
  WorkflowGraphSurface: (props: { initialUxFlowStepId?: string }) => {
    surfaceProps(props);
    return <div data-testid="surface" />;
  },
}));

const renderButton = () =>
  render(
    <OpenInUxFlowButton
      organizationId="org"
      projectId="project"
      mockupId="mockup"
    />,
  );

describe("OpenInUxFlowButton", () => {
  beforeEach(() => {
    surfaceProps.mockClear();
  });

  it("renders nothing for a Mockup that is in no UX flow", () => {
    flowsState.flows = [];
    const { container } = renderButton();

    expect(container).toBeEmptyDOMElement();
  });

  it("opens the only flow directly on this screen", () => {
    flowsState.flows = [
      { diagramId: "d1", diagramName: "Checkout", elementId: "el1" },
    ];
    renderButton();

    fireEvent.click(screen.getByTestId("open-in-ux-flow"));

    expect(screen.queryByTestId("ux-flow-choice")).toBeNull();
    expect(surfaceProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialUxFlowStepId: "el1" }),
    );
  });

  it("lets the person choose among several flows", () => {
    flowsState.flows = [
      { diagramId: "d1", diagramName: "Checkout", elementId: "el1" },
      { diagramId: "d2", diagramName: "Signup", elementId: "el2" },
    ];
    renderButton();

    fireEvent.click(screen.getByTestId("open-in-ux-flow"));
    expect(surfaceProps).not.toHaveBeenCalled();
    const choices = screen.getAllByTestId("ux-flow-choice");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "Checkout",
      "Signup",
    ]);

    fireEvent.click(choices[1]);

    expect(surfaceProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialUxFlowStepId: "el2" }),
    );
  });
});
