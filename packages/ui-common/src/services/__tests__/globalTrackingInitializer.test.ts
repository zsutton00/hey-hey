import { beforeEach, describe, expect, it, vi } from "vitest";

const trackerMocks = vi.hoisted(() => ({
  registerContextProvider: vi.fn(() => vi.fn()),
  setUserId: vi.fn(),
}));

vi.mock("../userActionTracker", () => ({
  userActionTracker: trackerMocks,
}));

import { GlobalTrackingInitializer } from "../globalTrackingInitializer";

describe("GlobalTrackingInitializer context cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unregisters user context when the user signs out", () => {
    const cleanup = vi.fn();
    trackerMocks.registerContextProvider.mockReturnValueOnce(cleanup);

    GlobalTrackingInitializer.setUserContext({
      id: "user-1",
      name: "First User",
      email: "first@example.com",
    });
    GlobalTrackingInitializer.setUserContext(null);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(trackerMocks.setUserId).toHaveBeenLastCalledWith(undefined);
  });

  it("unregisters entity context when its selection is cleared", () => {
    const cleanup = vi.fn();
    trackerMocks.registerContextProvider.mockReturnValueOnce(cleanup);

    GlobalTrackingInitializer.setOrganizationContext({
      id: "organization-1",
      name: "First Organization",
    });
    GlobalTrackingInitializer.setOrganizationContext(null);

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
