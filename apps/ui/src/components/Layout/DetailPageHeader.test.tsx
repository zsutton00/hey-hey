import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { DetailPageHeader } from "./DetailPageHeader";
import { PreviewPresentationProvider } from "../../contexts/PreviewPresentationContext";

describe("DetailPageHeader", () => {
  it("renders string entity titles as level-two headings with h4 typography", () => {
    render(<DetailPageHeader title="Configuration" />);

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Configuration",
    });

    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("MuiTypography-h4");
    expect(heading).toHaveStyle({
      fontFamily:
        '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
    });
    expect(screen.queryByRole("heading", { level: 4 })).not.toBeInTheDocument();
  });

  it("suppresses opted-in page chrome in Preview presentation", () => {
    render(
      <PreviewPresentationProvider>
        <DetailPageHeader title="Configuration" actions={<button>Save</button>} />
      </PreviewPresentationProvider>,
    );

    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("keeps custom title content full width on narrow headers", () => {
    render(
      <DetailPageHeader
        title={<div data-testid="custom-title">Features</div>}
      />,
    );

    expect(
      screen.getByTestId("custom-title").parentElement?.parentElement,
    ).toHaveStyle({
      width: "100%",
    });
  });
});
