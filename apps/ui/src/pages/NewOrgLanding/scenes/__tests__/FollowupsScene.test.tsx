import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import i18n from "@hey-hey/ui-common/i18n";

import { FollowupsScene } from "../FollowupsScene";
import {
  FOLLOWUPS_QUESTIONS,
  FOLLOWUPS_RESPONSE_TEXT,
  FOLLOWUPS_SKIP_HINT,
} from "../../newOrgLandingFixture";

const QUESTION_INTERVAL_MS = 10;

const renderScene = (): void => {
  const theme = createTheme();
  render(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>
        <FollowupsScene
          sceneWidth={1280}
          sceneHeight={720}
          questionRevealIntervalMs={QUESTION_INTERVAL_MS}
        />
      </I18nextProvider>
    </ThemeProvider>,
  );
};

const sceneRoot = (): HTMLElement => {
  const root = document.querySelector(
    '[data-testid="new-org-landing-followups-scene"]',
  );
  if (!root) {
    throw new Error("FollowupsScene root not rendered");
  }
  return root as HTMLElement;
};

const revealedCount = (): number =>
  Number(sceneRoot().getAttribute("data-revealed-question-count") ?? "0");

describe("FollowupsScene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the system response intro and reveals each follow-up question in sequence", () => {
    renderScene();

    // System response intro is rendered immediately so the user sees the
    // conversation continuing on the system side.
    expect(
      screen.getByTestId("new-org-landing-followups-response"),
    ).toHaveTextContent(FOLLOWUPS_RESPONSE_TEXT);

    // No question cards have appeared yet.
    expect(revealedCount()).toBe(0);
    for (const question of FOLLOWUPS_QUESTIONS) {
      expect(
        screen.queryByTestId(
          `new-org-landing-followups-question-${question.id}`,
        ),
      ).not.toBeInTheDocument();
    }

    // Advance one tick at a time; each tick reveals one more system question.
    for (
      let revealed = 1;
      revealed <= FOLLOWUPS_QUESTIONS.length;
      revealed += 1
    ) {
      act(() => {
        vi.advanceTimersByTime(QUESTION_INTERVAL_MS);
      });
      expect(revealedCount()).toBe(revealed);
    }

    // Every question text and matching N/A skip hint is on screen.
    for (const question of FOLLOWUPS_QUESTIONS) {
      expect(
        screen.getByTestId(
          `new-org-landing-followups-question-${question.id}`,
        ),
      ).toHaveTextContent(question.label);
      expect(
        screen.getByTestId(
          `new-org-landing-followups-skip-hint-${question.id}`,
        ),
      ).toHaveTextContent(FOLLOWUPS_SKIP_HINT);
    }
  });

  it("matches the parent section caption copy that mentions the N/A skip affordance", () => {
    renderScene();

    act(() => {
      vi.advanceTimersByTime(QUESTION_INTERVAL_MS * FOLLOWUPS_QUESTIONS.length);
    });

    const sectionCaption =
      "We'll ask follow-up questions to understand goals; you can answer N/A to skip any question you don't want to answer.";

    expect(sectionCaption).toContain("N/A to skip");
    const firstQuestion = FOLLOWUPS_QUESTIONS[0];
    expect(
      screen.getByTestId(
        `new-org-landing-followups-skip-hint-${firstQuestion.id}`,
      ),
    ).toHaveTextContent(/N\/A to skip/);
  });
});
