import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LegalDocumentLayout } from "./LegalDocumentLayout";

const renderDocument = (documentKey: "terms" | "privacy" | "security") =>
  render(
    <MemoryRouter>
      <LegalDocumentLayout documentKey={documentKey} />
    </MemoryRouter>,
  );

describe("LegalDocumentLayout", () => {
  it("renders version and effective date metadata on each disclosure", () => {
    for (const documentKey of ["terms", "privacy", "security"] as const) {
      const { unmount } = renderDocument(documentKey);

      expect(screen.getByText("Version 1.2-beta")).toBeInTheDocument();
      expect(screen.getByText("Effective September 14, 2026")).toBeInTheDocument();
      expect(screen.getByTestId(`legal-document-${documentKey}`)).toBeInTheDocument();

      unmount();
    }
  });

  it("uses compact visual styles while preserving semantic headings", () => {
    renderDocument("terms");

    expect(
      screen.getByRole("heading", { level: 1, name: "Terms of Service" }),
    ).toHaveClass("MuiTypography-h3");
    expect(
      screen.getByRole("heading", { level: 2, name: "Beta" }),
    ).toHaveClass("MuiTypography-h5");
  });

  it("renders all required security-boundary sections", () => {
    renderDocument("security");

    for (const sectionId of [
      "security-local-boundary",
      "security-platform-boundary",
      "security-provider-boundary",
      "security-credential-state",
      "security-passkeys",
      "security-grants-replay",
      "security-revocation",
      "security-recovery",
      "security-threat-exclusions",
      "security-residual-risks",
    ]) {
      expect(screen.getByTestId(`legal-section-${sectionId}`)).toBeInTheDocument();
    }

    const securityDocument = screen.getByTestId("legal-document-security");
    expect(
      securityDocument.querySelector('[data-claim-id="security-account-not-authority"]'),
    ).toBeInTheDocument();
    expect(
      securityDocument.querySelector('[data-claim-id="security-replay-retention"]'),
    ).toHaveTextContent(/at least ten minutes/i);
    expect(
      securityDocument.querySelector('[data-claim-id="security-provider-transfer"]'),
    ).toHaveTextContent(/Agent Bridge sends the context/i);
    expect(securityDocument).not.toHaveTextContent(/version-1/i);
    expect(securityDocument).not.toHaveTextContent(/legal@heyhey\.dev/i);
  });

  it("links Terms and Privacy to the detailed security paper", () => {
    for (const documentKey of ["terms", "privacy"] as const) {
      const { unmount } = renderDocument(documentKey);
      expect(
        screen.getAllByRole("link", { name: /Agent Bridge Security Boundary/i })
          .some((link) => link.getAttribute("href") === "/security"),
      ).toBe(true);
      unmount();
    }
  });
});
