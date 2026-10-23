import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import i18n from "@hey-hey/ui-common/i18n";

import { FeaturesScene } from "../FeaturesScene";
import {
  FEATURES_NARRATIVE_TEXT,
  FEATURES_PRIMARY_ACTION_LABEL,
  FEATURES_RESPONSE_TEXT,
  FEATURES_SECONDARY_ACTION_LABEL,
  FEATURES_TOP_LEVELS,
} from "../../newOrgLandingFixture";

const CHILD_INTERVAL_MS = 5;

const renderScene = (): void => {
  const theme = createTheme();
  render(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>
        <FeaturesScene
          sceneWidth={1280}
          sceneHeight={720}
          childRevealIntervalMs={CHILD_INTERVAL_MS}
        />
      </I18nextProvider>
    </ThemeProvider>,
  );
};

const totalChildCount = (): number =>
  FEATURES_TOP_LEVELS.reduce((sum, tl) => sum + tl.children.length, 0);

describe("FeaturesScene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the response and narrative copy plus all top-level names immediately", () => {
    renderScene();

    expect(
      screen.getByTestId("new-org-landing-features-response"),
    ).toHaveTextContent(FEATURES_RESPONSE_TEXT);
    expect(
      screen.getByTestId("new-org-landing-features-narrative"),
    ).toHaveTextContent(FEATURES_NARRATIVE_TEXT);

    for (const topLevel of FEATURES_TOP_LEVELS) {
      expect(
        screen.getByTestId(`new-org-landing-features-section-${topLevel.id}`),
      ).toHaveTextContent(topLevel.name);
    }
  });

  it("reveals every child sequentially and surfaces the primary and secondary action labels", () => {
    renderScene();

    expect(
      screen.queryAllByTestId(/^new-org-landing-features-child-/),
    ).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(CHILD_INTERVAL_MS * totalChildCount());
    });

    for (const topLevel of FEATURES_TOP_LEVELS) {
      for (const child of topLevel.children) {
        expect(
          screen.getByTestId(`new-org-landing-features-child-${child.id}`),
        ).toHaveTextContent(child.name);
      }
    }

    expect(
      screen.getByTestId("new-org-landing-features-primary-action"),
    ).toHaveTextContent(FEATURES_PRIMARY_ACTION_LABEL);
    expect(
      screen.getByTestId("new-org-landing-features-secondary-action"),
    ).toHaveTextContent(FEATURES_SECONDARY_ACTION_LABEL);
  });
});
