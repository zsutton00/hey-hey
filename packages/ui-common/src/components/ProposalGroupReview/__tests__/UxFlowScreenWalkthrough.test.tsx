import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { UxFlowScreenWalkthrough } from "../UxFlowScreenWalkthrough";
import type { UxFlowShape } from "../deriveScreenNextOptions";

const flow: UxFlowShape = {
  steps: [
    { id: "cart", name: "Cart" },
    { id: "pay", name: "Payment" },
    { id: "failed", name: "Payment failed" },
    { id: "done", name: "Receipt" },
  ],
  edges: [
    {
      id: "e1",
      sourceNodeId: "cart",
      targetNodeId: "pay",
      actionLabel: "Check out",
      transitionRole: "PRIMARY_PROGRESSION",
    },
    {
      id: "e2",
      sourceNodeId: "pay",
      targetNodeId: "failed",
      actionLabel: "Card declined",
      transitionRole: "ERROR_PATH",
    },
    {
      id: "e3",
      sourceNodeId: "pay",
      targetNodeId: "done",
      actionLabel: "Pay",
      transitionRole: "PRIMARY_PROGRESSION",
    },
    {
      id: "e4",
      sourceNodeId: "pay",
      targetNodeId: "cart",
      actionLabel: "Edit cart",
    },
  ],
};

function open(initialScreenId: string, onFollowScreenLink = vi.fn()) {
  render(
    <MemoryRouter>
      <UxFlowScreenWalkthrough
        flowName="Checkout"
        flow={flow}
        savedPositions={new Map()}
        initialScreenId={initialScreenId}
        renderScreen={(id) => <div>{`screen:${id}`}</div>}
        screenHref={(id) => `/mockups/${id}`}
        onFollowScreenLink={onFollowScreenLink}
      />
    </MemoryRouter>,
  );
}

const shown = () =>
  screen.getByTestId("ux-flow-screen").getAttribute("data-screen-id");

describe("UxFlowScreenWalkthrough", () => {
  it("lists a screen's next options and follows the chosen one", () => {
    open("pay");

    expect(screen.getByText("Next (3)")).toBeInTheDocument();
    expect(screen.queryByText("Other options")).toBeNull();
    fireEvent.click(screen.getByTestId("ux-flow-next-button"));
    const panel = screen.getByTestId("ux-flow-next-panel");
    const options = within(panel).getAllByTestId("ux-flow-next-option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Pay→ Receipt",
      "Card declined→ Payment failed",
      "Edit cart→ Cart",
    ]);

    fireEvent.click(options[1]);

    expect(shown()).toBe("failed");
    expect(screen.queryByTestId("ux-flow-next-panel")).toBeNull();
  });

  it("goes back to the screen the person came from", () => {
    open("cart");
    expect(screen.queryByTestId("ux-flow-back-button")).toBeNull();

    fireEvent.click(screen.getByTestId("ux-flow-next-button"));
    expect(shown()).toBe("pay");

    fireEvent.click(screen.getByTestId("ux-flow-back-button"));
    expect(shown()).toBe("cart");
  });

  it("goes straight to the only next screen without a count or panel", () => {
    open("cart");

    const next = screen.getByTestId("ux-flow-next-button");
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.queryByText(/Next \(/)).toBeNull();
    expect(next).toHaveAccessibleName("Next: Check out");

    fireEvent.click(next);

    expect(shown()).toBe("pay");
    expect(screen.queryByTestId("ux-flow-next-panel")).toBeNull();
  });

  it("shows a disabled Next button when a screen has no next options", () => {
    open("done");

    const next = screen.getByTestId("ux-flow-next-button");
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleName("No next options");
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("titles the screen with a link to its Mockup page and names the flow and position", () => {
    const onFollowScreenLink = vi.fn();
    open("pay", onFollowScreenLink);

    const title = screen.getByTestId("ux-flow-screen-title-link");
    expect(title).toHaveTextContent("Payment");
    expect(title).toHaveAttribute("href", "/mockups/pay");
    expect(screen.getByText("Screen 2 of 4")).toBeInTheDocument();
    expect(screen.queryByTestId("ux-flow-open-full")).toBeNull();

    fireEvent.click(title);
    expect(onFollowScreenLink).toHaveBeenCalledTimes(1);
  });

  it("steps through screens with the arrow keys", () => {
    open("cart");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(shown()).toBe("pay");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(shown()).toBe("cart");
  });
});
