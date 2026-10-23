import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PublicMarketingShell } from "./PublicMarketingShell";

const renderShell = (children: React.ReactNode) =>
  render(
    <MemoryRouter>
      <PublicMarketingShell>{children}</PublicMarketingShell>
    </MemoryRouter>,
  );

describe("PublicMarketingShell", () => {
  it("grows short content before a static, non-overlay footer", () => {
    renderShell(<main>Short public page</main>);

    const shell = screen.getByTestId("public-marketing-shell");
    const content = screen.getByTestId("public-marketing-content");
    const footer = screen.getByTestId("site-legal-footer");

    expect(window.getComputedStyle(shell).display).toBe("flex");
    expect(window.getComputedStyle(shell).flexDirection).toBe("column");
    expect(window.getComputedStyle(shell).minHeight).toBe("100vh");
    expect(window.getComputedStyle(content).flexGrow).toBe("1");
    expect(window.getComputedStyle(footer).position).toBe("static");
    expect(window.getComputedStyle(footer).flexShrink).toBe("0");
    expect(content.nextElementSibling).toBe(footer);
  });

  it("keeps the footer in document order after content-rich pages", () => {
    renderShell(
      <div data-testid="content-rich-page">
        {Array.from({ length: 40 }, (_, index) => (
          <p key={index}>Product proof section {index + 1}</p>
        ))}
      </div>,
    );

    const content = screen.getByTestId("public-marketing-content");
    const footer = screen.getByTestId("site-legal-footer");

    expect(content.compareDocumentPosition(footer)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(window.getComputedStyle(footer).position).toBe("static");
  });

  it.each([375, 768, 1280])(
    "allows the legal footer to wrap at a %ipx viewport",
    (viewportWidth) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: viewportWidth,
      });

      renderShell(<div>Responsive public page</div>);

      const footer = screen.getByTestId("site-legal-footer");
      expect(window.getComputedStyle(footer).flexWrap).toBe("wrap");
      expect(screen.getByText("Hey Hey beta")).toBeInTheDocument();
      expect(screen.getByTestId("legal-link-terms")).toHaveAttribute(
        "href",
        "/terms",
      );
      expect(screen.getByTestId("legal-link-privacy")).toHaveAttribute(
        "href",
        "/privacy",
      );
      expect(screen.getByTestId("legal-link-security")).toHaveAttribute(
        "href",
        "/security",
      );
    },
  );
});
