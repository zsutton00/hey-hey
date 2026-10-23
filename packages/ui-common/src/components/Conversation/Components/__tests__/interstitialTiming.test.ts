import { describe, expect, it } from "vitest";
import {
  getElapsedInterstitialDurationMs,
  getInterstitialSegments,
  getInterstitialTiming,
} from "../interstitialTiming";

describe("getInterstitialTiming", () => {
  it("parses and removes the producer timestamp from each segment", () => {
    expect(
      getInterstitialSegments(
        "First thought -- 2024-01-01T12:00:00Z\n──────────\nSecond thought -- 2024-01-01T12:00:07.123Z"
      )
    ).toEqual([
      {
        text: "First thought",
        timestamp: "2024-01-01T12:00:00Z",
      },
      {
        text: "Second thought",
        timestamp: "2024-01-01T12:00:07.123Z",
      },
    ]);
  });

  it("uses timestamps from the first and final response segments", () => {
    expect(
      getInterstitialTiming(
        "First thought -- 2024-01-01T12:00:00Z\n──────────\nSecond thought -- 2024-01-01T12:00:07Z"
      )
    ).toEqual({
      startAt: "2024-01-01T12:00:00Z",
      endAt: "2024-01-01T12:00:07Z",
    });
  });

  it("uses a single timestamp as both the start and final segment", () => {
    expect(
      getInterstitialTiming("Only thought -- 2024-01-01T12:00:00Z")
    ).toEqual({
      startAt: "2024-01-01T12:00:00Z",
      endAt: "2024-01-01T12:00:00Z",
    });
  });

  it("returns null when no valid producer timestamps are available", () => {
    expect(
      getInterstitialTiming("No timestamp\n──────────\nStill no timestamp")
    ).toBeNull();
  });

  it("uses the first valid timestamp and requires the final segment for sealing", () => {
    expect(
      getInterstitialTiming(
        "Unstamped\n──────────\nStarted -- 2024-01-01T12:00:00.000Z\n──────────\nUnstamped final"
      )
    ).toEqual({ startAt: "2024-01-01T12:00:00.000Z" });
  });

  it("calculates live duration from the current clock and sealed duration from the final segment", () => {
    const timing = getInterstitialTiming(
      "Started -- 2024-01-01T12:00:00Z\n──────────\nFinished -- 2024-01-01T12:00:07Z"
    );

    expect(timing).not.toBeNull();
    expect(
      getElapsedInterstitialDurationMs(
        timing!,
        Date.parse("2024-01-01T12:00:05Z"),
        true
      )
    ).toBe(5000);
    expect(
      getElapsedInterstitialDurationMs(
        timing!,
        Date.parse("2024-01-01T12:00:20Z"),
        false
      )
    ).toBe(7000);
  });
});
