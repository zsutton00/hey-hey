import { ThemeProvider } from "@mui/material/styles";
import { getContrastRatio } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectContext } from "../../../../contexts";
import { describe, expect, it, vi } from "vitest";
import { createHeyTheme } from "../../../../contexts/ThemeContext";
import type {
  ConversationCardRole,
  ConversationCardSeverity,
} from "../../../../contexts/ThemeContext";
import { ConversationCard } from "../ConversationCard";
import { ConversationCardRelatedRows } from "../ConversationCardRelatedRows";
import { ConversationCardSection } from "../ConversationCardSection";
import { SolidAlert } from "../SolidAlert";

const ROLES: ConversationCardRole[] = [
  "projectSync",
  "needsAnswer",
  "agentMessage",
  "informational",
];
const SEVERITIES: ConversationCardSeverity[] = ["high", "medium", "low"];
const MODES = ["light", "dark"] as const;

const withTheme = (mode: "light" | "dark", ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>
      <ProjectContext.Provider
        value={{
          organizationId: "org-1",
          projectId: "project-1",
          navigate: vi.fn(),
        }}
      >
        <ThemeProvider theme={createHeyTheme(mode)}>{ui}</ThemeProvider>
      </ProjectContext.Provider>
    </MemoryRouter>
  </QueryClientProvider>
);

describe("conversation card theme tokens", () => {
  it.each(MODES)("defines readable tokens in %s mode", (mode) => {
    const { palette } = createHeyTheme(mode);
    const { roles, severities } = palette.conversationCard;
    const tones = [
      ...Object.values(roles),
      ...Object.values(severities),
      palette.conversationAlert.warning,
      palette.conversationAlert.error,
    ];

    expect(Object.keys(roles).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(severities).sort()).toEqual([...SEVERITIES].sort());
    for (const tone of tones) {
      expect(
        getContrastRatio(tone.main, tone.contrastText),
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const severity of Object.values(severities)) {
      expect(severity.main).not.toBe(palette.conversationAlert.error.main);
    }
  });
});

describe("ConversationCard", () => {
  it.each(MODES)("frames every role and severity in %s mode", (mode) => {
    const theme = createHeyTheme(mode);
    const tones = [
      ...ROLES.map((role) => ({
        tone: { role },
        colors: theme.palette.conversationCard.roles[role],
      })),
      ...SEVERITIES.map((severity) => ({
        tone: { severity },
        colors: theme.palette.conversationCard.severities[severity],
      })),
    ];

    for (const { tone, colors } of tones) {
      const { unmount } = render(
        withTheme(
          mode,
          <ConversationCard tone={tone} icon={<span />} kindLabel="Kind" />,
        ),
      );
      const card = screen.getByTestId("conversation-card");
      const style = getComputedStyle(card);

      expect(style.borderTopWidth).toBe("2px");
      expect(style.borderLeftWidth).toBe("2px");
      expect(style.borderLeftColor).toBe(style.borderRightColor);
      expect(style.borderTopColor).toBe(style.borderBottomColor);
      expect(card.outerHTML).not.toContain("border-left:");
      expect(style.backgroundColor).not.toBe("");
      expect(colors.main).toBeTruthy();
      unmount();
    }
  });

  it("renders header, lead, sections, rows and one primary footer action in order", () => {
    const onPrimary = vi.fn();
    render(
      withTheme(
        "light",
        <ConversationCard
          tone={{ role: "projectSync" }}
          icon={<span data-testid="icon" />}
          kindLabel="Project sync"
          chips={<span>chip</span>}
          lead="One sentence."
          footer={{
            primary: { label: "Apply", onClick: onPrimary },
            secondary: [{ label: "Dismiss", onClick: vi.fn() }],
          }}
        >
          <ConversationCardSection label="Affected">
            <ConversationCardRelatedRows
              numbered
              rows={[
                {
                  key: "a",
                  reason: "Needs a decision",
                  state: { label: "your decision", emphasis: "needsAnswer" },
                },
              ]}
            />
          </ConversationCardSection>
        </ConversationCard>,
      ),
    );

    const card = screen.getByTestId("conversation-card");
    const order = [
      "conversation-card-header",
      "conversation-card-lead",
      "conversation-card-body",
      "conversation-card-footer",
    ].map((id) => within(card).getByTestId(id));

    for (let i = 0; i < order.length - 1; i += 1) {
      expect(
        order[i].compareDocumentPosition(order[i + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(
      screen.getByTestId("conversation-card-section-label"),
    ).toHaveTextContent("Affected");
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(1);
    screen.getByRole("button", { name: "Apply" }).click();
    expect(onPrimary).toHaveBeenCalled();
  });
});

describe("ConversationCard disabled primary", () => {
  it.each(MODES)("renders a disabled, inert primary in %s mode", (mode) => {
    const onPrimary = vi.fn();
    render(
      withTheme(
        mode,
        <ConversationCard
          tone={{ role: "projectSync" }}
          icon={<span />}
          kindLabel="Project sync"
          footer={{
            primary: { label: "Apply", onClick: onPrimary, disabled: true },
          }}
        />,
      ),
    );

    const button = screen.getByRole("button", { name: "Apply" });
    expect(button).toBeDisabled();
    button.click();
    expect(onPrimary).not.toHaveBeenCalled();
  });
});

describe("ConversationCardRelatedRows", () => {
  const mention = {
    entityType: "TASK",
    entityId: "52d83a47-b9ed-4793-9154-942a841201dd",
    entityName: "Shared card shell",
  };

  it("renders chip, dash and reason; chip-only and reason-only rows stay list rows", () => {
    render(
      withTheme(
        "dark",
        <ConversationCardRelatedRows
          numbered
          rows={[
            { key: "1", mention, reason: "Depends on it" },
            { key: "2", mention },
            { key: "3", reason: "Update the docs" },
          ]}
        />,
      ),
    );

    expect(screen.getByTestId("conversation-card-related-rows").tagName).toBe(
      "OL",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByTestId("conversation-card-row-dash")).toHaveLength(1);
    expect(screen.getAllByTestId("conversation-card-row-reason")).toHaveLength(
      2,
    );
    expect(screen.getAllByTestId("conversation-card-row-number")).toHaveLength(
      3,
    );
  });
});

describe("ConversationCardRelatedRows visual-artifact mentions", () => {
  it.each(["diagram", "mockup"])(
    "keeps a %s reference as a chip row instead of expanding a preview",
    (entityType) => {
      render(
        withTheme(
          "light",
          <ConversationCardRelatedRows
            rows={[
              {
                key: "a",
                mention: {
                  entityType,
                  entityId: "6f0d7c2e-8c1f-4f5e-9c43-1b2f4a7d9e10",
                  entityName: "Artifact",
                },
                reason: "Shows the flow",
              },
            ]}
          />,
        ),
      );

      const row = screen.getByTestId("conversation-card-related-row");

      expect(row).toHaveTextContent("Artifact");
      expect(row).toHaveTextContent("Shows the flow");
      expect(screen.getByTestId("conversation-card-row-dash")).toBeVisible();
      expect(
        within(row).queryByTestId("workflow-inline-mention"),
      ).not.toBeInTheDocument();
      expect(
        row.querySelector("iframe, svg[data-testid*='diagram' i]"),
      ).toBeNull();
    },
  );
});

describe("SolidAlert", () => {
  it("uses status for warnings and alert for errors", () => {
    render(
      withTheme(
        "light",
        <>
          <SolidAlert severity="warning">careful</SolidAlert>
          <SolidAlert severity="error">broken</SolidAlert>
        </>,
      ),
    );

    expect(screen.getByRole("status")).toHaveTextContent("careful");
    expect(screen.getByRole("alert")).toHaveTextContent("broken");
  });
});
