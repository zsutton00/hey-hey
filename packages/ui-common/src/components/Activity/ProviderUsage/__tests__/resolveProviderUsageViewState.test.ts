import { describe, expect, it } from "vitest";
import type { CliReadProviderUsage } from "../../../../api";
import {
  elapsedPercent,
  presentLimitWindow,
  resolveProviderUsageViewState,
} from "../resolveProviderUsageViewState";

const providers: CliReadProviderUsage[] = [
  {
    provider: "codex",
    status: "reported",
    observedAt: "2026-10-01T00:00:00.000Z",
    fiveHour: { usedPercent: 12, resetsAt: "2026-10-01T05:00:00.000Z" },
    weekly: { usedPercent: 40, resetsAt: "2026-10-07T00:00:00.000Z" },
  },
];

const base = {
  providers: null,
  typedError: null,
  requestError: null,
  isInitialLoading: false,
};

describe("resolveProviderUsageViewState", () => {
  it("separates a timed-out CLI from an unreachable one", () => {
    expect(
      resolveProviderUsageViewState({
        ...base,
        typedError: { code: "TIMEOUT", message: "Slow." },
      })
    ).toEqual({ kind: "timeout", message: "Slow." });
    expect(
      resolveProviderUsageViewState({
        ...base,
        typedError: { code: "NO_RECIPIENT", message: "Offline." },
      })
    ).toEqual({ kind: "unavailable", message: "Offline." });
  });

  it("reports loading before any reading arrives", () => {
    expect(
      resolveProviderUsageViewState({ ...base, isInitialLoading: true })
    ).toEqual({ kind: "initial-loading" });
  });

  it("is ready once providers are read", () => {
    expect(resolveProviderUsageViewState({ ...base, providers })).toEqual({
      kind: "ready",
      providers,
    });
  });
});

describe("presentLimitWindow", () => {
  const format = (value: string) => `at ${value}`;

  it("reads not reported instead of zero for missing values", () => {
    expect(presentLimitWindow(null, format)).toEqual({
      used: "not reported",
      resets: "not reported",
    });
    expect(
      presentLimitWindow({ usedPercent: null, resetsAt: "r" }, format)
    ).toEqual({ used: "not reported", resets: "at r" });
  });

  it("shows a reported zero as zero", () => {
    expect(
      presentLimitWindow({ usedPercent: 0, resetsAt: null }, format).used
    ).toBe("0% used");
  });
});

describe("elapsedPercent", () => {
  const now = Date.parse("2026-10-01T00:00:00.000Z");

  it("returns the elapsed share 48 hours into a 168-hour window", () => {
    expect(
      elapsedPercent("2026-10-06T00:00:00.000Z", 168, now)
    ).toBeCloseTo(28.57, 2);
  });

  it("calculates elapsed share for a 5-hour window", () => {
    expect(elapsedPercent("2026-10-01T03:00:00.000Z", 5, now)).toBe(40);
  });

  it.each([null, undefined, "not-a-date"])(
    "returns null for a missing or invalid reset time: %s",
    (resetsAt) => {
      expect(elapsedPercent(resetsAt, 168, now)).toBeNull();
    }
  );

  it("returns null for expired resets and resets beyond the window", () => {
    expect(elapsedPercent("2026-10-01T00:00:00.000Z", 168, now)).toBeNull();
    expect(elapsedPercent("2026-10-08T01:00:00.000Z", 168, now)).toBeNull();
  });
});
