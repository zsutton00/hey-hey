import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import * as React from "react";
import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import {
  LastOrganizationOwnerError,
  useRemoveOrganizationMember,
} from "../useRemoveOrganizationMember";
import { unifiedApiClient } from "../../../clients/serviceClients";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    removeOrganizationMember: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(Provider, null, children);

const baseVariables = {
  organizationId: "org-1",
  userId: "user-1",
};

describe("useRemoveOrganizationMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls removeOrganizationMember on the unified client with the correct args", async () => {
    vi.mocked(unifiedApiClient.removeOrganizationMember).mockResolvedValue(
      undefined as never
    );

    const { result } = renderHook(() => useRemoveOrganizationMember(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutate(baseVariables);
    });

    expect(unifiedApiClient.removeOrganizationMember).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", userId: "user-1" })
    );
  });

  it("invokes onSuccess after a successful removal", async () => {
    vi.mocked(unifiedApiClient.removeOrganizationMember).mockResolvedValue(
      undefined as never
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(
      () => useRemoveOrganizationMember({ onSuccess }),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutate(baseVariables);
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  it("maps a 400 response to LastOrganizationOwnerError", async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      "last-owner",
      "ERR_BAD_REQUEST",
      undefined,
      {},
      {
        status: 400,
        data: { message: "Cannot remove the last owner of an organization" },
        statusText: "Bad Request",
        headers: {},
        config: { headers },
      }
    );
    vi.mocked(unifiedApiClient.removeOrganizationMember).mockRejectedValue(
      axiosError
    );

    const onError = vi.fn();
    const { result } = renderHook(
      () => useRemoveOrganizationMember({ onError }),
      { wrapper }
    );

    await act(async () => {
      await expect(result.current.mutate(baseVariables)).rejects.toBeInstanceOf(
        LastOrganizationOwnerError
      );
    });

    expect(onError).toHaveBeenCalledWith(
      expect.any(LastOrganizationOwnerError)
    );
  });

  it("propagates non-400 axios errors unchanged", async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      "server error",
      "ERR_BAD_RESPONSE",
      undefined,
      {},
      {
        status: 500,
        data: { message: "Boom" },
        statusText: "Internal Server Error",
        headers: {},
        config: { headers },
      }
    );
    vi.mocked(unifiedApiClient.removeOrganizationMember).mockRejectedValue(
      axiosError
    );

    const { result } = renderHook(() => useRemoveOrganizationMember(), {
      wrapper,
    });

    await act(async () => {
      await expect(result.current.mutate(baseVariables)).rejects.toBe(
        axiosError
      );
    });
  });
});
