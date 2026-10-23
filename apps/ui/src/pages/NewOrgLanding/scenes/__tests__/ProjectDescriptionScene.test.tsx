import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import i18n from "@hey-hey/ui-common/i18n";

import { ProjectDescriptionScene } from "../ProjectDescriptionScene";
import {
  PROJECT_DESCRIPTION_LABELS,
  PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES,
} from "../../newOrgLandingFixture";

const renderScene = (target: string): void => {
  const theme = createTheme();
  render(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>
        <ProjectDescriptionScene
          sceneWidth={1280}
          sceneHeight={720}
          conceptTarget={target}
          typeIntervalMs={10}
          selectRevealDelayMs={20}
        />
      </I18nextProvider>
    </ThemeProvider>,
  );
};

const sceneAttributes = (): {
  typedConcept: string;
  projectMaturity: string;
  teamSize: string;
  orgContext: string;
} => {
  const root = document.querySelector(
    '[data-testid="new-org-landing-project-description-scene"]',
  );
  if (!root) {
    throw new Error("ProjectDescriptionScene root not rendered");
  }
  return {
    typedConcept: root.getAttribute("data-typed-concept") ?? "",
    projectMaturity: root.getAttribute("data-project-maturity") ?? "",
    teamSize: root.getAttribute("data-team-size") ?? "",
    orgContext: root.getAttribute("data-org-context") ?? "",
  };
};

describe("ProjectDescriptionScene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("types the project concept one character at a time and resolves the representative selects", () => {
    const target = "My project";
    renderScene(target);

    // Initial render: empty textarea, no selects resolved.
    const initial = sceneAttributes();
    expect(initial.typedConcept).toBe("");
    expect(initial.projectMaturity).toBe("");
    expect(initial.teamSize).toBe("");
    expect(initial.orgContext).toBe("");

    // Cursor is visible while typing has not yet completed.
    expect(
      screen.getByTestId("project-description-typing-cursor"),
    ).toBeInTheDocument();

    // Advance 3 ticks → first 3 characters typed.
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(sceneAttributes().typedConcept).toBe(target.slice(0, 3));
    expect(sceneAttributes().projectMaturity).toBe("");

    // Advance through the rest of the typing animation.
    act(() => {
      vi.advanceTimersByTime(target.length * 10);
    });
    expect(sceneAttributes().typedConcept).toBe(target);

    // After the post-typing reveal delay, selects resolve to the
    // representative values we expose for the demo scene.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const final = sceneAttributes();
    expect(final.typedConcept).toBe(target);
    expect(final.projectMaturity).toBe(
      PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES.projectMaturity,
    );
    expect(final.teamSize).toBe(
      PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES.teamSize,
    );
    expect(final.orgContext).toBe(
      PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES.orgContext,
    );

    // Once selects have resolved, the cursor is no longer rendered.
    expect(
      screen.queryByTestId("project-description-typing-cursor"),
    ).not.toBeInTheDocument();
  });

  it("renders the question labels for each form field", () => {
    renderScene("hi");

    expect(
      screen.getByText(PROJECT_DESCRIPTION_LABELS.project_concept),
    ).toBeInTheDocument();
    expect(
      screen.getByText(PROJECT_DESCRIPTION_LABELS.project_maturity),
    ).toBeInTheDocument();
    expect(
      screen.getByText(PROJECT_DESCRIPTION_LABELS.team_size),
    ).toBeInTheDocument();
    expect(
      screen.getByText(PROJECT_DESCRIPTION_LABELS.org_context),
    ).toBeInTheDocument();
  });
});
