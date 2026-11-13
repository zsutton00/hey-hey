import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EvalAttemptReport } from "@hey-hey/ui-common/data";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

import { AttemptTurns } from "./AttemptTurns";

const attemptWith = (payload: Record<string, unknown>): EvalAttemptReport =>
  ({ id: "attempt", payload }) as unknown as EvalAttemptReport;

describe("AttemptTurns", () => {
  it("shows nothing for an attempt recorded without a conversation", () => {
    render(<AttemptTurns attempt={attemptWith({})} plannedMessages={1} />);

    expect(screen.queryByTestId("eval-attempt-turns")).toBeNull();
  });

  it("shows how far a failed conversation got and that nothing was judged", () => {
    render(
      <AttemptTurns
        plannedMessages={3}
        attempt={attemptWith({
          turns: [
            {
              index: 0,
              input: "a",
              state: "COMPLETED",
              measurement: { scope: "TARGET_HANDLER", elapsedMs: 4000 },
            },
            { index: 1, input: "b", state: "FAILED" },
          ],
        })}
      />,
    );

    expect(
      screen.getByTestId("eval-attempt-turns-progress").textContent,
    ).toContain('{"started":2,"completed":1,"planned":3}');
    expect(
      screen.getByTestId("eval-attempt-turns-progress").textContent,
    ).toContain("eval.results.turns.notJudged");
    // The failed message reported nothing, and is not shown as a zero.
    expect(screen.getByTestId("eval-attempt-turn-1").textContent).toContain(
      "eval.results.turns.unavailable",
    );
  });

  it("marks the judged message", () => {
    render(
      <AttemptTurns
        plannedMessages={2}
        attempt={attemptWith({
          judgedTurnIndex: 1,
          turns: [
            { index: 0, input: "a", state: "COMPLETED" },
            { index: 1, input: "b", state: "COMPLETED" },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("eval-attempt-turn-1").textContent).toContain(
      "eval.case.inputs.judged",
    );
    expect(screen.getByTestId("eval-attempt-turn-0").textContent).not.toContain(
      "eval.case.inputs.judged",
    );
  });
});
