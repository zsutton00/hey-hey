import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isInitiatorTrackingEnabled,
  REQUEST_INITIATOR_TRACKING_STORAGE_KEY,
} from "../initiatorContext";

describe("request initiator tracking configuration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("is disabled when the localStorage setting is absent", () => {
    expect(isInitiatorTrackingEnabled()).toBe(false);
  });

  it("is enabled only when the localStorage setting is true", () => {
    window.localStorage.setItem(
      REQUEST_INITIATOR_TRACKING_STORAGE_KEY,
      "true",
    );

    expect(isInitiatorTrackingEnabled()).toBe(true);

    window.localStorage.setItem(
      REQUEST_INITIATOR_TRACKING_STORAGE_KEY,
      "false",
    );
    expect(isInitiatorTrackingEnabled()).toBe(false);
  });

  it("stays disabled when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    expect(isInitiatorTrackingEnabled()).toBe(false);
  });
});
