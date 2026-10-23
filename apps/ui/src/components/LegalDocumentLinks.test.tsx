import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LegalDocumentLinks } from "./LegalDocumentLinks";

describe("LegalDocumentLinks", () => {
  it("exposes all disclosures from shared public and authenticated navigation", () => {
    render(
      <MemoryRouter>
        <LegalDocumentLinks />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("legal-link-terms")).toHaveAttribute("href", "/terms");
    expect(screen.getByTestId("legal-link-privacy")).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByTestId("legal-link-security")).toHaveAttribute(
      "href",
      "/security",
    );
  });
});
