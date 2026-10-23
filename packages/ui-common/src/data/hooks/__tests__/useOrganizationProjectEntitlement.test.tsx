import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformClient } from "../../../clients/serviceClients";
import { useOrganizationProjectEntitlement } from "../useOrganizationProjectEntitlement";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getOrganizationProjectEntitlement: vi.fn(),
  },
}));

const resolvedEntitlement = {
  defaultProjectLimit: 2,
  projectLimitOverride: null,
  projectLimit: 2,
  usage: {
    projectCount: 1,
    workItemCount: 500,
    observedAt: "2026-08-11T20:00:00.000Z",
  },
  canCreateProject: true,
  creationUnavailableReason: null,
};

describe("useOrganizationProjectEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      platformClient.getOrganizationProjectEntitlement
    ).mockResolvedValue({ data: { data: resolvedEntitlement } } as never);
  });

  it("publishes the backend-resolved availability without using a project array", async () => {
    const { result } = renderHook(() =>
      useOrganizationProjectEntitlement("org-1")
    );

    await waitFor(() => expect(result.current.entitlement).toEqual(resolvedEntitlement));
    expect(result.current.entitlement?.usage.workItemCount).toBe(500);
  });

  it("refreshes the entitlement from the server", async () => {
    const { result } = renderHook(() =>
      useOrganizationProjectEntitlement("org-1", { enabled: false })
    );

    await act(async () => {
      await result.current.refetch();
    });

    expect(platformClient.getOrganizationProjectEntitlement).toHaveBeenCalledWith({
      organizationId: "org-1",
    });
  });
});
