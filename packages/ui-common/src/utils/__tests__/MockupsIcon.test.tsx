import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MockupsIcon } from "../icons/Mockups";

describe("MockupsIcon", () => {
  it("renders the pencil geometry as an accessible, currentColor MUI icon", () => {
    render(<MockupsIcon titleAccess="Mockups" />);

    const icon = screen.getByRole("img", { name: "Mockups" });
    const paths = icon.querySelectorAll("path");

    expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
    expect(icon).toHaveClass("MuiSvgIcon-root");
    expect(paths[0]).toHaveAttribute("fill", "none");
    expect(paths[1]).toHaveAttribute("fill", "currentColor");
    expect(paths[1]).toHaveAttribute(
      "d",
      "M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.5.5 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"
    );
  });
});
