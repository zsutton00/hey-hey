import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { ProjectMaturity } from "../../api";
import { ProjectTakingShapeLabel } from "./ProjectTakingShapeLabel";

const explanation =
  "While this project is taking shape, agents look to your past conversations for context and offer to record what matters.";

describe("ProjectTakingShapeLabel", () => {
  it("omits the label and explanation when established", () => {
    render(<ProjectTakingShapeLabel maturity={ProjectMaturity.Established} />);
    expect(screen.queryByText("Taking shape")).not.toBeInTheDocument();
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();
  });
  it.each(["hover", "focus"])(
    "exposes the exact explanation on %s",
    async (method) => {
      render(
        <ProjectTakingShapeLabel maturity={ProjectMaturity.TakingShape} />,
      );
      const label = screen.getByTestId("project-taking-shape-label");
      expect(label).toHaveAttribute("tabindex", "0");
      if (method === "hover") fireEvent.mouseOver(label);
      else await userEvent.tab();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(explanation);
    },
  );
});
