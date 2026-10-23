import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../AuthContext";

const authServiceMocks = vi.hoisted(() => ({
  getBrowserSelection: vi.fn(() => null),
  getAuthToken: vi.fn<() => string | null>(),
  getCurrentUser: vi.fn<() => unknown>(),
  getBrowserSessionContinuityDecision: vi.fn(),
  refreshAuthToken: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  changeCurrentPassword: vi.fn(),
  initiatePasswordRecovery: vi.fn(),
  toggleDevAdminMode: vi.fn(),
  onAuthChange: vi.fn(() => () => undefined),
}));

vi.mock("../../services/authService", () => ({
  ...authServiceMocks,
  BrowserSessionContinuityDecision: {
    RenewFromServer: "renew-from-server",
    RemainSignedOut: "remain-signed-out",
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("AuthContext.completeChangePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.getAuthToken.mockReturnValue(null);
    authServiceMocks.getCurrentUser.mockReturnValue(null);
    authServiceMocks.getBrowserSessionContinuityDecision.mockReturnValue(
      "renew-from-server"
    );
    authServiceMocks.refreshAuthToken.mockRejectedValue(
      new Error("no refresh")
    );
  });

  it("flips isAuthenticated to true and sets user when changePassword resolves", async () => {
    const tokens = {
      accessToken: "new-access-token",
      expiresIn: 900,
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      },
    };
    authServiceMocks.changePassword.mockResolvedValue(tokens);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.completeChangePassword(
        "password-change-token",
        "new-password"
      );
    });

    expect(authServiceMocks.changePassword).toHaveBeenCalledWith(
      "password-change-token",
      "new-password"
    );
    expect(returned).toEqual(tokens);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(tokens.user);
  });

  it("clears auth state and rethrows when changePassword rejects", async () => {
    authServiceMocks.changePassword.mockRejectedValue(
      new Error("invalid token")
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(
        result.current.completeChangePassword("bad-token", "new-password")
      ).rejects.toThrow("invalid token");
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(authServiceMocks.refreshAuthToken).toHaveBeenCalledOnce();
  });
});

describe("AuthContext.switchOrganization", () => {
  it("adopts the authoritative user returned by session rotation", async () => {
    authServiceMocks.getAuthToken.mockReturnValue("access-token");
    authServiceMocks.getCurrentUser.mockReturnValue({
      id: "user-1",
      email: "test@example.com",
      currentOrganizationId: "org-1",
    });
    const switchedUser = {
      id: "user-1",
      email: "test@example.com",
      currentOrganizationId: "org-2",
    };
    authServiceMocks.refreshAuthToken.mockResolvedValue({
      accessToken: "org-2-token",
      expiresIn: 900,
      user: switchedUser,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.switchOrganization("org-2");
    });

    expect(authServiceMocks.refreshAuthToken).toHaveBeenCalledWith(
      undefined,
      "org-2"
    );
    expect(result.current.user).toEqual(switchedUser);
  });
});

describe("AuthContext.initiatePasswordRecovery", () => {
  it("returns the acknowledgement while preserving signed-out state", async () => {
    authServiceMocks.getAuthToken.mockReturnValue(null);
    authServiceMocks.getCurrentUser.mockReturnValue(null);
    authServiceMocks.getBrowserSessionContinuityDecision.mockReturnValue(
      "remain-signed-out"
    );
    authServiceMocks.initiatePasswordRecovery.mockResolvedValue({
      message:
        "If an eligible account exists, recovery instructions will be sent.",
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.initiatePasswordRecovery("person@example.com")
    ).resolves.toBe(
      "If an eligible account exists, recovery instructions will be sent."
    );
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });
});

describe("AuthContext.changeCurrentPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.getAuthToken.mockReturnValue("existing-access-token");
    authServiceMocks.getCurrentUser.mockReturnValue({
      id: "user-1",
      email: "test@example.com",
    });
    authServiceMocks.getBrowserSessionContinuityDecision.mockReturnValue(
      "renew-from-server"
    );
  });

  it("updates the current user after a successful signed-in password change", async () => {
    const tokens = {
      accessToken: "replacement-access-token",
      expiresIn: 900,
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      },
    };
    authServiceMocks.changeCurrentPassword.mockResolvedValue(tokens);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.changeCurrentPassword(
        "current-password",
        "replacement-password"
      );
    });

    expect(authServiceMocks.changeCurrentPassword).toHaveBeenCalledWith(
      "current-password",
      "replacement-password"
    );
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(tokens.user);
  });

  it("preserves the existing authenticated context when the mutation rejects", async () => {
    authServiceMocks.changeCurrentPassword.mockRejectedValue(
      new Error("Current password is incorrect")
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(
        result.current.changeCurrentPassword(
          "wrong-password",
          "replacement-password"
        )
      ).rejects.toThrow("Current password is incorrect");
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({
      id: "user-1",
      email: "test@example.com",
    });
  });
});

describe("AuthContext browser session startup and login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.getAuthToken.mockReturnValue(null);
    authServiceMocks.getCurrentUser.mockReturnValue(null);
    authServiceMocks.getBrowserSessionContinuityDecision.mockReturnValue(
      "renew-from-server"
    );
  });

  it("settles a rejected legacy startup renewal into one stable signed-out state", async () => {
    authServiceMocks.refreshAuthToken.mockRejectedValue(
      new Error("legacy session rejected")
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(authServiceMocks.refreshAuthToken).toHaveBeenCalledOnce();

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
    expect(authServiceMocks.refreshAuthToken).toHaveBeenCalledOnce();
  });

  it("authenticates a new login without a JavaScript-visible refresh credential", async () => {
    const browserAuthResponse = {
      accessToken: "new-access-token",
      expiresIn: 900,
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        isActive: true,
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    };
    authServiceMocks.refreshAuthToken.mockRejectedValue(
      new Error("signed out")
    );
    authServiceMocks.login.mockResolvedValue(browserAuthResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.login({
        email: "test@example.com",
        password: "password",
      });
    });

    expect(returned).toEqual(browserAuthResponse);
    expect(returned).not.toHaveProperty("refreshToken");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(browserAuthResponse.user);
  });

  it("stays signed out across provider remounts after successful explicit logout", async () => {
    authServiceMocks.getBrowserSessionContinuityDecision.mockReturnValue(
      "remain-signed-out"
    );

    const first = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(first.result.current.loading).toBe(false);
    });
    first.unmount();

    const second = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(second.result.current.loading).toBe(false);
    });

    expect(second.result.current.isAuthenticated).toBe(false);
    expect(second.result.current.user).toBeNull();
    expect(authServiceMocks.refreshAuthToken).not.toHaveBeenCalled();
  });

  it("attempts one server renewal after a reload resets runtime suppression", async () => {
    authServiceMocks.refreshAuthToken.mockRejectedValue(
      new Error("logout cookies were cleared")
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(authServiceMocks.refreshAuthToken).toHaveBeenCalledOnce();
  });

  it("preserves authenticated context when explicit logout fails", async () => {
    const currentUser = {
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
    };
    authServiceMocks.getAuthToken.mockReturnValue("active-access-token");
    authServiceMocks.getCurrentUser.mockReturnValue(currentUser);
    authServiceMocks.logout.mockRejectedValue(new Error("logout failed"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.logout()).rejects.toThrow("logout failed");
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(currentUser);
  });
});
