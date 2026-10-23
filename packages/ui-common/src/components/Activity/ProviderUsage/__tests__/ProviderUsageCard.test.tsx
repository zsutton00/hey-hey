import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliReadProviderUsage } from "../../../../api";
import { ProviderUsageCard } from "../ProviderUsageCard";

const now = Date.parse("2026-10-01T00:00:00.000Z");

const makeUsage = (
  overrides: Partial<CliReadProviderUsage> = {}
): CliReadProviderUsage => ({
  provider: "codex",
  status: "reported",
  observedAt: null,
  fiveHour: { usedPercent: 25, resetsAt: "2026-10-01T03:00:00.000Z" },
  weekly: { usedPercent: 40, resetsAt: "2026-10-06T00:00:00.000Z" },
  ...overrides,
});

describe("ProviderUsageCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("places pace markers from the 5-hour and weekly reset times", () => {
    render(<ProviderUsageCard usage={makeUsage()} />);

    expect(
      screen.getByTestId("provider-usage-card-codex-five-hour-pace-marker")
    ).toHaveStyle({ left: "40%" });
    expect(
      screen.getByTestId("provider-usage-card-codex-weekly-pace-marker")
    ).toHaveStyle({ left: "28.57142857142857%" });
  });

  it("moves the pace markers as the clock advances", () => {
    render(<ProviderUsageCard usage={makeUsage()} />);

    const marker = screen.getByTestId(
      "provider-usage-card-codex-weekly-pace-marker"
    );
    const initialPosition = getComputedStyle(marker).left;

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(getComputedStyle(marker).left).not.toBe(initialPosition);
  });

  it("omits markers when usage or reset time is missing", () => {
    render(
      <ProviderUsageCard
        usage={
          makeUsage({
            fiveHour: { usedPercent: null, resetsAt: "2026-10-01T03:00:00.000Z" },
            weekly: { usedPercent: 40, resetsAt: null },
          })
        }
      />
    );

    expect(
      screen.queryByTestId("provider-usage-card-codex-five-hour-pace-marker")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("provider-usage-card-codex-weekly-pace-marker")
    ).not.toBeInTheDocument();
  });

  it("omits a marker when the reset time has passed", () => {
    render(
      <ProviderUsageCard
        usage={
          makeUsage({
            fiveHour: { usedPercent: 25, resetsAt: "2026-09-30T23:59:59.000Z" },
          })
        }
      />
    );

    expect(
      screen.queryByTestId("provider-usage-card-codex-five-hour-pace-marker")
    ).not.toBeInTheDocument();
  });
});
