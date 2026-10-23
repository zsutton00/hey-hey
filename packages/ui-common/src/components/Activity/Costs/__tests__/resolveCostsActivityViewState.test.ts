import { describe, expect, it } from "vitest";
import type { ProjectSessionCostsCollectionResult } from "../../../../data/hooks/useProjectSessionCosts";
import { resolveCostsActivityViewState } from "../resolveCostsActivityViewState";

const result = (
  overrides: Partial<ProjectSessionCostsCollectionResult> = {}
): ProjectSessionCostsCollectionResult => ({
  items: [],
  nextCursor: null,
  sourceAvailability: "available",
  costReadAt: "2026-07-28T12:00:00.000Z",
  ...overrides,
});

const base = {
  result: null,
  typedError: null,
  requestError: null,
  isInitialLoading: false,
  isLoadingMore: false,
};

describe("resolveCostsActivityViewState", () => {
  it("distinguishes initial loading from an empty successful read", () => {
    expect(
      resolveCostsActivityViewState({ ...base, isInitialLoading: true })
    ).toEqual({ kind: "initial-loading" });

    expect(
      resolveCostsActivityViewState({ ...base, result: result() })
    ).toMatchObject({ kind: "empty" });
  });

  it("keeps timeout, unavailable, and typed source failures distinct", () => {
    expect(
      resolveCostsActivityViewState({
        ...base,
        typedError: { code: "TIMEOUT", message: "Timed out." },
      })
    ).toMatchObject({ kind: "timeout" });
    expect(
      resolveCostsActivityViewState({
        ...base,
        typedError: {
          code: "MACHINE_NOT_BOUND",
          message: "No machine.",
        },
      })
    ).toMatchObject({ kind: "unavailable" });
    expect(
      resolveCostsActivityViewState({
        ...base,
        typedError: { code: "READ_FAILED", message: "Read failed." },
      })
    ).toMatchObject({ kind: "source-error" });
  });

  it("does not collapse source unavailability into successful emptiness", () => {
    expect(
      resolveCostsActivityViewState({
        ...base,
        result: result({ sourceAvailability: "unavailable" }),
      })
    ).toMatchObject({ kind: "unavailable" });
  });

  it("renders fully unavailable session rows instead of hiding them", () => {
    expect(
      resolveCostsActivityViewState({
        ...base,
        result: result({
          sourceAvailability: "unavailable",
          items: [
            {
              agentSessionId: "11111111-1111-4111-8111-111111111111",
              conversationId: "22222222-2222-4222-8222-222222222222",
              context: {
                entityType: null,
                entityId: null,
                entityTitle: null,
                promptType: null,
              },
              providerSessions: [],
              knownCostUsd: null,
              completeness: "unavailable",
              latestActivityAt: "2026-07-28T11:00:00.000Z",
              costReadAt: "2026-07-28T12:00:00.000Z",
            },
          ],
        }),
      })
    ).toMatchObject({ kind: "ready" });
  });

  it("preserves populated load-more state", () => {
    const ready = resolveCostsActivityViewState({
      ...base,
      result: result({
        items: [
          {
            agentSessionId: "11111111-1111-4111-8111-111111111111",
            conversationId: "22222222-2222-4222-8222-222222222222",
            context: {
              entityType: null,
              entityId: null,
              entityTitle: null,
              promptType: null,
            },
            providerSessions: [],
            knownCostUsd: null,
            completeness: "unavailable",
            latestActivityAt: "2026-07-28T11:00:00.000Z",
            costReadAt: "2026-07-28T12:00:00.000Z",
          },
        ],
      }),
      isLoadingMore: true,
    });

    expect(ready).toMatchObject({
      kind: "ready",
      isLoadingMore: true,
    });
  });
});
