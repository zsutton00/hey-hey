import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { en } from "../../../i18n/locales/en";
import { evalRunName } from "../evalRunName";
import type { EvalRunReport } from "../evalRuns";

const t = ((key: string) => (en as Record<string, string>)[key]) as TFunction;

const setup = (
  model: string,
  reasoningEffort: string,
  handlerConfig?: Record<string, unknown>,
) => ({
  id: `${model}-${reasoningEffort}`,
  target: {
    provider: "claude",
    model,
    reasoningEffort,
    ...(handlerConfig ? { handlerConfig } : {}),
  },
});

const run = (
  configurations: ReturnType<typeof setup>[],
  name?: string,
): EvalRunReport =>
  ({
    id: "run-1",
    title: "Eval Run",
    payload: {
      reportType: "EVAL_RUN",
      configurations,
      ...(name ? { name } : {}),
    },
  }) as unknown as EvalRunReport;

describe("evalRunName", () => {
  it("shows a run by the name it was given", () => {
    expect(evalRunName(run([setup("opus", "high")], "Baseline"), t)).toBe(
      "Baseline",
    );
  });

  it("builds a name from setups, handler and Project Assistant", () => {
    const handlerConfig = { handler: "entity_conversation" };
    const name = evalRunName(
      run([
        setup("opus", "high", handlerConfig),
        setup("sonnet", "medium", handlerConfig),
      ]),
      t,
    );
    expect(name).toBe(
      "opus · high, sonnet · medium · Entity conversation, Project Assistant prepares",
    );
  });

  it("names runs recorded without handler data from their setups alone", () => {
    expect(evalRunName(run([setup("opus", "high")]), t)).toBe("opus · high");
  });

  it("tells runs of the same setups apart by handler and Project Assistant", () => {
    const names = [
      undefined,
      { handler: "entity_conversation" },
      { handler: "entity_conversation", projectAssistant: { enabled: false } },
      { handler: "agent_search" },
      { handler: "project_assistant" },
      { projectAssistant: { enabled: false } },
    ].map((handlerConfig) =>
      evalRunName(run([setup("opus", "high", handlerConfig)]), t),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
