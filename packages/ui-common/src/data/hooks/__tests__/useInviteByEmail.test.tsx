import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import * as React from "react";
import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import { DuplicateEmailError, useInviteByEmail } from "../useInviteByEmail";
import { OrganizationRole, ProjectRole } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    inviteToOrganization: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(Provider, null, children);

const baseVariables = {
  organizationId: "org-1",
  projectId: "proj-1",
  email: "new@example.com",
  role: ProjectRole.Member,
};

const mockMember = {
  id: "member-1",
  userId: "user-1",
  organizationId: "org-1",
  role: "MEMBER",
  isActive: true,
  createdAt: "2026-04-17T00:00:00Z",
  user: {
    id: "user-1",
    email: "new@example.com",
    name: "New User",
    isActive: true,
    createdAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
  },
};

describe("useInviteByEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends email + org-level Member role + project assignment with selected ProjectRole", async () => {
    vi.mocked(unifiedApiClient.inviteToOrganization).mockResolvedValue({
      data: { data: mockMember },
    } as never);

    const { result } = renderHook(() => useInviteByEmail(), { wrapper });

    await act(async () => {
      await result.current.mutate(baseVariables);
    });

    expect(unifiedApiClient.inviteToOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        inviteToOrganizationDto: {
          email: "new@example.com",
          role: OrganizationRole.Member,
          projects: [{ projectId: "proj-1", role: ProjectRole.Member }],
        },
      })
    );
  });

  it("resolves with the returned member on success and marks the user collection stale", async () => {
    vi.mocked(unifiedApiClient.inviteToOrganization).mockResolvedValue({
      data: { data: mockMember },
    } as never);

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useInviteByEmail({ onSuccess }), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutate(baseVariables);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(onSuccess).toHaveBeenCalledWith(mockMember);
  });

  it("maps a 409 response to DuplicateEmailError", async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      "duplicate",
      "ERR_BAD_REQUEST",
      undefined,
      {},
      {
        status: 409,
        data: { message: "Email already in organization" },
        statusText: "Conflict",
        headers: {},
        config: { headers },
      }
    );
    vi.mocked(unifiedApiClient.inviteToOrganization).mockRejectedValue(
      axiosError
    );

    const onError = vi.fn();
    const { result } = renderHook(() => useInviteByEmail({ onError }), {
      wrapper,
    });

    await act(async () => {
      await expect(result.current.mutate(baseVariables)).rejects.toBeInstanceOf(
        DuplicateEmailError
      );
    });

    expect(onError).toHaveBeenCalledWith(expect.any(DuplicateEmailError));
  });

  it("propagates non-409 axios errors unchanged", async () => {
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
    vi.mocked(unifiedApiClient.inviteToOrganization).mockRejectedValue(
      axiosError
    );

    const { result } = renderHook(() => useInviteByEmail(), { wrapper });

    await act(async () => {
      await expect(result.current.mutate(baseVariables)).rejects.toBe(
        axiosError
      );
    });
  });

  it("throws when the API returns no member data", async () => {
    vi.mocked(unifiedApiClient.inviteToOrganization).mockResolvedValue({
      data: { data: undefined },
    } as never);

    const { result } = renderHook(() => useInviteByEmail(), { wrapper });

    await act(async () => {
      await expect(result.current.mutate(baseVariables)).rejects.toThrow(
        /no member/i
      );
    });
  });
});
