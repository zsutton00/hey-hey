import { Button } from "@mui/material";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Card } from "../Card";

describe("Card", () => {
  it("renders its semantic shell, title, and composable body without an action", () => {
    render(
      <Card title="Tracked work" dataTestId="tracked-work-card">
        <p>Consumer-owned content</p>
      </Card>,
    );

    const card = screen.getByTestId("tracked-work-card");
    expect(card).toHaveAccessibleName("Tracked work");
    const heading = screen.getByRole("heading", { name: "Tracked work" });
    expect(heading).toBeVisible();
    expect(heading).toHaveStyle({ fontSize: "1rem" });
    expect(screen.getByText("Consumer-owned content")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws a leading icon before the title", () => {
    render(
      <Card title="Checkout" icon={<svg data-testid="card-icon" />}>
        Body
      </Card>,
    );

    const heading = screen.getByRole("heading", { name: "Checkout" });
    expect(
      screen.getByTestId("card-icon").compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the title as a link when a title handler is supplied", async () => {
    const user = userEvent.setup();
    const onTitleClick = vi.fn();

    render(
      <Card title="Checkout" onTitleClick={onTitleClick}>
        Body
      </Card>,
    );

    await user.click(screen.getByRole("button", { name: "Checkout" }));

    expect(onTitleClick).toHaveBeenCalledOnce();
  });

  it("renders and preserves a consumer-supplied header action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <Card
        title="Feature tree"
        action={<Button onClick={onAction}>Expand</Button>}
      >
        Tree content
      </Card>,
    );

    await user.click(screen.getByRole("button", { name: "Expand" }));

    expect(onAction).toHaveBeenCalledOnce();
  });
});
