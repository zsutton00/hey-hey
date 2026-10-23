import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import * as React from "react";
import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import {
  LastProjectOwnerError,
  useRemoveProjectMember,
} from "../useRemoveProjectMember";
import { unifiedApiClient } from "../../../clients/serviceClients";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    removeProjectMember: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(Provider, null, children);

const baseVariables = {
  organizationId: "org-1",
  projectId: "proj-1",
  userId: "user-1",
};

describe("useRemoveProjectMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls removeProjectMember on the unified client with the correct args", async () => {
    vi.mocked(unifiedApiClient.removeProjectMember).mockResolvedValue(
      undefined as never
    );

    const { result } = renderHook(() => useRemoveProjectMember(), { wrapper });

    await act(async () => {
      await result.current.mutate(baseVariables);
    });

    expect(unifiedApiClient.removeProjectMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        userId: "user-1",
      })
    );
  });

  it("invokes onSuccess after a successful removal", async () => {
    vi.mocked(unifiedApiClient.removeProjectMember).mockResolvedValue(
      undefined as never
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useRemoveProjectMember({ onSuccess }), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutate(baseVariables);
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  it("maps a 400 response to LastProjectOwnerError", async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      "last-owner",
      "ERR_BAD_REQUEST",
      undefined,
      {},
      {
        status: 400,
        data: { message: "Cannot remove the last owner of a project" },
        statusText: "Bad Request",
        headers: {},
        config: { headers },
      }
    );
    vi.mocked(unifiedApiClient.removeProjectMember).mockRejectedValue(
      axiosError
    );

    const onError = vi.fn();
    const { result } = renderHook(() => useRemoveProjectMember({ onError }), {
      wrapper,
    });

    await act(async () => {
      await expect(result.current.mutate(baseVariables)).rejects.toBeInstanceOf(
        LastProjectOwnerError
      );
    });

    expect(onError).toHaveBeenCalledWith(expect.any(LastProjectOwnerError));
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
    vi.mocked(unifiedApiClient.removeProjectMember).mockRejectedValue(
      axiosError
    );

    const { result } = renderHook(() => useRemoveProjectMember(), { wrapper });

    await act(async () => {
      await expect(result.current.mutate(baseVariables)).rejects.toBe(
        axiosError
      );
    });
  });
});
