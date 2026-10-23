import { describe, expect, it } from "vitest";
import { AgentSessionStatus } from "../../../../../api";
import { resolveHasSentInitialPrompt } from "../agent-session-helpers";

describe("resolveHasSentInitialPrompt", () => {
  it("keeps a brand-new session in not-started state", () => {
    expect(
      resolveHasSentInitialPrompt({
        agentSessionStatus: AgentSessionStatus.NotStarted,
      })
    ).toBe(false);
  });

  it("treats an in-progress session as having sent its initial prompt", () => {
    expect(
      resolveHasSentInitialPrompt({
        agentSessionStatus: AgentSessionStatus.InProgress,
      })
    ).toBe(true);
  });

  it("treats a completed session as having sent its initial prompt", () => {
    expect(
      resolveHasSentInitialPrompt({
        agentSessionStatus: AgentSessionStatus.Completed,
      })
    ).toBe(true);
  });
});
