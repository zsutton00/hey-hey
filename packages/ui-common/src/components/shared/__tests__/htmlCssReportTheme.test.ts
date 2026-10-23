import { describe, expect, it } from "vitest";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import { HTML_CSS_REPORT_THEME } from "../htmlCssReportTheme";

describe("HTML_CSS_REPORT_THEME", () => {
  it("takes its palette and typography from the Hey Hey light theme", () => {
    const { palette, typography } = createHeyTheme("light");

    expect(HTML_CSS_REPORT_THEME).toContain(
      `--hh-text: ${palette.text.primary};`
    );
    expect(HTML_CSS_REPORT_THEME).toContain(
      `--hh-primary: ${palette.primary.main};`
    );
    expect(HTML_CSS_REPORT_THEME).toContain(
      `--hh-divider: ${palette.divider};`
    );
    expect(HTML_CSS_REPORT_THEME).toContain(
      `font-family: ${typography.fontFamily};`
    );
  });

  it("strips left accent borders, including authored ones", () => {
    expect(HTML_CSS_REPORT_THEME).not.toMatch(/border-left:/);
    expect(HTML_CSS_REPORT_THEME).toContain(
      "body *, body *::before, body *::after { border-left-width: 0 !important; border-inline-start-width: 0 !important; }"
    );
  });
});
