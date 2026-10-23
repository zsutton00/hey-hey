import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthServiceModule = typeof import("../authService");

type BroadcastMessageListener = (event: { data: unknown }) => void;

class TestBroadcastChannel {
  static channels: TestBroadcastChannel[] = [];
  static postedMessages: unknown[] = [];

  private readonly listeners = new Set<BroadcastMessageListener>();

  constructor(readonly name: string) {
    TestBroadcastChannel.channels.push(this);
  }

  addEventListener(
    eventName: string,
    listener: BroadcastMessageListener
  ): void {
    if (eventName === "message") {
      this.listeners.add(listener);
    }
  }

  postMessage(message: unknown): void {
    TestBroadcastChannel.postedMessages.push(message);
    setTimeout(() => {
      TestBroadcastChannel.channels.forEach((channel) => {
        if (channel !== this && channel.name === this.name) {
          channel.listeners.forEach((listener) => listener({ data: message }));
        }
      });
    });
  }

  static reset(): void {
    TestBroadcastChannel.channels = [];
    TestBroadcastChannel.postedMessages = [];
  }
}

class TestLockManager {
  private tail: Promise<void> = Promise.resolve();

  request<Result>(
    _name: string,
    callback: () => Result | PromiseLike<Result>
  ): Promise<Result> {
    const result = this.tail.then(callback, callback);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

const clientMocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  changeCurrentPassword: vi.fn(),
  initiatePasswordRecovery: vi.fn(),
  refreshToken: vi.fn(),
  setAuthToken: vi.fn(),
}));

vi.mock("../../clients/runtime", () => ({
  getApiClient: () => ({
    login: clientMocks.login,
    logout: clientMocks.logout,
    changePassword: clientMocks.changePassword,
    changeCurrentPassword: clientMocks.changeCurrentPassword,
    initiatePasswordRecovery: clientMocks.initiatePasswordRecovery,
    refreshToken: clientMocks.refreshToken,
  }),
  getApiRuntime: () => ({
    transport: {
      setAuthToken: clientMocks.setAuthToken,
    },
  }),
}));

import {
  BrowserSessionContinuityDecision,
  changePassword,
  changeCurrentPassword,
  clearAuthToken,
  getAuthToken,
  getCurrentUser,
  getBrowserSessionContinuityDecision,
  login,
  initiatePasswordRecovery,
  logout,
  onAuthChange,
  refreshAuthToken,
  setAuthToken,
} from "../authService";

const recoveryAcknowledgement =
  "If an eligible account exists, recovery instructions will be sent.";

const resetAuthState = (): void => {
  setAuthToken("test-reset-token");
  clearAuthToken();
  vi.clearAllMocks();
};

const browserUser = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  email: "test@example.com",
  name: "Test User",
  isActive: true,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

const responseEnvelope = (data: unknown) => ({
  data: {
    success: true,
    message: "Signed in",
    data,
    timestamp: "2026-07-27T00:00:00.000Z",
    statusCode: 200,
  },
});

describe("explicit browser selection", () => {
  beforeEach(resetAuthState);
  it("preserves identity without scoped access and recovers after an explicit choice", async () => {
    const organizationId = "550e8400-e29b-41d4-a716-446655440002";
    const selection = {
      status: "selection_denied",
      user: { ...browserUser, currentOrganizationId: null },
      organizations: [{ id: organizationId, name: "Selected organization" }],
    };
    setAuthToken("obsolete-access");
    clientMocks.refreshToken.mockResolvedValueOnce(responseEnvelope(selection));
    expect(await refreshAuthToken()).toEqual(selection);
    expect(getAuthToken()).toBeNull();
    expect(getCurrentUser()).toEqual(selection.user);
    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RenewFromServer
    );
    clientMocks.refreshToken.mockResolvedValueOnce(
      responseEnvelope({
        user: { ...browserUser, currentOrganizationId: organizationId },
        accessToken: "confirmed-access",
        expiresIn: 900,
      })
    );
    await refreshAuthToken(undefined, organizationId);
    expect(getAuthToken()).toBe("confirmed-access");
  });

  it("serializes an explicit switch behind renewal without Web Locks", async () => {
    let finish!: (value: ReturnType<typeof responseEnvelope>) => void;
    clientMocks.refreshToken.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const renewal = refreshAuthToken();
    const organizationId = "550e8400-e29b-41d4-a716-446655440002";
    clientMocks.refreshToken.mockResolvedValueOnce(
      responseEnvelope({
        user: { ...browserUser, currentOrganizationId: organizationId },
        accessToken: "switched",
        expiresIn: 900,
      })
    );
    const switching = refreshAuthToken(undefined, organizationId);
    expect(clientMocks.refreshToken).toHaveBeenCalledTimes(1);
    finish(
      responseEnvelope({
        user: browserUser,
        accessToken: "renewed",
        expiresIn: 900,
      })
    );
    await Promise.all([renewal, switching]);
    expect(clientMocks.refreshToken).toHaveBeenLastCalledWith({
      refreshBrowserSessionDto: { organizationId },
    });
    expect(getAuthToken()).toBe("switched");
  });
});

describe("authService.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthState();
  });

  it("accepts a browser-safe response and stores only its access token", async () => {
    const browserAuthResponse = {
      user: browserUser,
      accessToken: "access-token",
      expiresIn: 900,
    };
    clientMocks.login.mockResolvedValue(responseEnvelope(browserAuthResponse));

    const result = await login({
      email: "test@example.com",
      password: "password",
    });

    expect(result).toEqual(browserAuthResponse);
    expect(result).not.toHaveProperty("refreshToken");
    expect(getAuthToken()).toBe("access-token");
    expect(clientMocks.setAuthToken).toHaveBeenCalledOnce();
    expect(clientMocks.setAuthToken).toHaveBeenCalledWith("access-token");
  });

  it.each([
    {
      name: "missing access token",
      response: { user: browserUser, expiresIn: 900 },
    },
    {
      name: "missing expiry",
      response: { user: browserUser, accessToken: "access-token" },
    },
    {
      name: "missing required user fields",
      response: {
        user: {
          id: "550e8400-e29b-41d4-a716-446655440001",
          email: "test@example.com",
        },
        accessToken: "access-token",
        expiresIn: 900,
      },
    },
    {
      name: "containing a JavaScript-visible refresh token",
      response: {
        user: browserUser,
        accessToken: "access-token",
        refreshToken: "must-not-be-exposed",
        expiresIn: 900,
      },
    },
  ])("rejects a malformed response: $name", async ({ response }) => {
    clientMocks.login.mockResolvedValue(responseEnvelope(response));

    await expect(
      login({
        email: "test@example.com",
        password: "password",
      })
    ).rejects.toThrow("Invalid browser authentication response");

    expect(getAuthToken()).toBeNull();
    expect(clientMocks.setAuthToken).not.toHaveBeenCalled();
  });
});

describe("authService.initiatePasswordRecovery", () => {
  beforeEach(resetAuthState);

  it("returns the fixed acknowledgement without changing auth state", async () => {
    clientMocks.initiatePasswordRecovery.mockResolvedValue(
      responseEnvelope({ message: recoveryAcknowledgement })
    );

    await expect(
      initiatePasswordRecovery("person@example.com")
    ).resolves.toEqual({ message: recoveryAcknowledgement });
    expect(clientMocks.initiatePasswordRecovery).toHaveBeenCalledWith({
      passwordRecoveryRequestDto: { email: "person@example.com" },
    });
    expect(getAuthToken()).toBeNull();
  });

  it("rejects response drift instead of inventing an acknowledgement", async () => {
    clientMocks.initiatePasswordRecovery.mockResolvedValue(
      responseEnvelope({ message: "Account exists" })
    );

    await expect(
      initiatePasswordRecovery("person@example.com")
    ).rejects.toThrow("unexpected error occurred during password recovery");
  });
});

describe("authService.refreshAuthToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthState();
  });

  it("returns one shared renewal promise and stores the validated browser response", async () => {
    const browserAuthResponse = {
      user: browserUser,
      accessToken: "renewed-access-token",
      expiresIn: 900,
    };
    clientMocks.refreshToken.mockResolvedValue(
      responseEnvelope(browserAuthResponse)
    );
    const authChanges = vi.fn();
    const unsubscribe = onAuthChange(authChanges);

    const firstRenewal = refreshAuthToken();
    const secondRenewal = refreshAuthToken();

    expect(secondRenewal).toBe(firstRenewal);
    await expect(firstRenewal).resolves.toEqual(browserAuthResponse);
    expect(clientMocks.refreshToken).toHaveBeenCalledOnce();
    expect(getAuthToken()).toBe("renewed-access-token");
    expect(authChanges).toHaveBeenCalledWith(true, "renewed-access-token");
    unsubscribe();
  });

  it("rotates into an explicitly requested authorized organization", async () => {
    const switched = {
      user: {
        ...browserUser,
        currentOrganizationId: "550e8400-e29b-41d4-a716-446655440002",
      },
      accessToken: "org-2-access-token",
      expiresIn: 900,
    };
    clientMocks.refreshToken.mockResolvedValue(responseEnvelope(switched));

    await expect(
      refreshAuthToken(undefined, "550e8400-e29b-41d4-a716-446655440002")
    ).resolves.toEqual(switched);
    expect(clientMocks.refreshToken).toHaveBeenCalledWith({
      refreshBrowserSessionDto: {
        organizationId: "550e8400-e29b-41d4-a716-446655440002",
      },
    });
    expect(getAuthToken()).toBe("org-2-access-token");
  });

  it("preserves the current access token when an organization switch is rejected", async () => {
    setAuthToken("current-access-token");
    clientMocks.refreshToken.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403 },
    });

    await expect(
      refreshAuthToken(undefined, "550e8400-e29b-41d4-a716-446655440002")
    ).rejects.toThrow("Access forbidden.");
    expect(getAuthToken()).toBe("current-access-token");
  });

  it("clears browser access once when shared renewal fails", async () => {
    setAuthToken("expired-access-token");
    const authChanges = vi.fn();
    const unsubscribe = onAuthChange(authChanges);
    clientMocks.refreshToken.mockResolvedValue(
      responseEnvelope({
        user: browserUser,
        accessToken: 42,
        expiresIn: 900,
      })
    );

    const firstRenewal = refreshAuthToken();
    const secondRenewal = refreshAuthToken();

    await expect(firstRenewal).rejects.toThrow(
      "unexpected error occurred during token refresh"
    );
    await expect(secondRenewal).rejects.toThrow(
      "unexpected error occurred during token refresh"
    );
    expect(clientMocks.refreshToken).toHaveBeenCalledOnce();
    expect(getAuthToken()).toBeNull();
    expect(authChanges).toHaveBeenCalledOnce();
    expect(authChanges).toHaveBeenCalledWith(false, null);
    unsubscribe();
  });
});

describe("authService cross-tab renewal", () => {
  const loadIsolatedTab = async (): Promise<AuthServiceModule> => {
    vi.resetModules();
    return import("../authService");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    vi.stubGlobal("navigator", { locks: new TestLockManager() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes isolated tabs and propagates only the browser-safe result", async () => {
    const ownerTab = await loadIsolatedTab();
    const peerTab = await loadIsolatedTab();
    const browserAuthResponse = {
      user: browserUser,
      accessToken: "renewed-access-token",
      expiresIn: 900,
    };
    let resolveRefresh:
      | ((value: ReturnType<typeof responseEnvelope>) => void)
      | undefined;
    clientMocks.refreshToken.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );

    const ownerRenewal = ownerTab.refreshAuthToken();
    const peerRenewal = peerTab.refreshAuthToken();
    await vi.waitFor(() => {
      expect(clientMocks.refreshToken).toHaveBeenCalledOnce();
    });

    resolveRefresh?.(responseEnvelope(browserAuthResponse));

    await expect(ownerRenewal).resolves.toEqual(browserAuthResponse);
    await expect(peerRenewal).resolves.toEqual(browserAuthResponse);
    expect(clientMocks.refreshToken).toHaveBeenCalledOnce();
    expect(peerTab.getAuthToken()).toBe("renewed-access-token");
    expect(TestBroadcastChannel.postedMessages).toEqual([browserAuthResponse]);
    expect(Object.keys(TestBroadcastChannel.postedMessages[0] ?? {})).toEqual([
      "user",
      "accessToken",
      "expiresIn",
    ]);
  });

  it("releases ownership after an unpublished failure so the next tab can renew", async () => {
    const failedOwnerTab = await loadIsolatedTab();
    const recoveryTab = await loadIsolatedTab();
    const recoveredResponse = {
      user: browserUser,
      accessToken: "recovered-access-token",
      expiresIn: 900,
    };
    clientMocks.refreshToken
      .mockRejectedValueOnce(new Error("owner exited"))
      .mockResolvedValueOnce(responseEnvelope(recoveredResponse));

    const failedRenewal = failedOwnerTab.refreshAuthToken();
    const recoveredRenewal = recoveryTab.refreshAuthToken();

    await expect(failedRenewal).rejects.toThrow(
      "unexpected error occurred during token refresh"
    );
    await expect(recoveredRenewal).resolves.toEqual(recoveredResponse);
    expect(clientMocks.refreshToken).toHaveBeenCalledTimes(2);
    expect(recoveryTab.getAuthToken()).toBe("recovered-access-token");
  });

  it("adopts validated renewal results in an idle tab", async () => {
    const ownerTab = await loadIsolatedTab();
    const idleTab = await loadIsolatedTab();
    const initialBrowserAuthResponse = {
      user: browserUser,
      accessToken: "initial-access-token",
      expiresIn: 900,
    };
    const browserAuthResponse = {
      user: browserUser,
      accessToken: "renewed-access-token",
      expiresIn: 900,
    };

    clientMocks.refreshToken.mockResolvedValue(
      responseEnvelope(initialBrowserAuthResponse)
    );
    await idleTab.refreshAuthToken();
    await new Promise((resolve) => setTimeout(resolve, 0));

    idleTab.setAuthToken("idle-tab-access-token");
    clientMocks.refreshToken.mockResolvedValue(
      responseEnvelope(browserAuthResponse)
    );

    await ownerTab.refreshAuthToken();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(idleTab.getAuthToken()).toBe("renewed-access-token");
  });
});

describe("authService.changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthState();
  });

  it("accepts only the browser-safe response and stores its user and access token", async () => {
    const browserAuthResponse = {
      user: browserUser,
      accessToken: "replacement-access-token",
      expiresIn: 900,
    };
    clientMocks.changePassword.mockResolvedValue(
      responseEnvelope(browserAuthResponse)
    );

    await expect(
      changePassword("password-change-token", "replacement-password")
    ).resolves.toEqual(browserAuthResponse);

    expect(getAuthToken()).toBe("replacement-access-token");
    expect(clientMocks.setAuthToken).toHaveBeenCalledWith(
      "replacement-access-token"
    );
    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RenewFromServer
    );
  });

  it("rejects a refresh-bearing result and settles unauthenticated once", async () => {
    setAuthToken("stale-access-token");
    vi.clearAllMocks();
    const authChanges = vi.fn();
    const unsubscribe = onAuthChange(authChanges);
    clientMocks.changePassword.mockResolvedValue(
      responseEnvelope({
        user: browserUser,
        accessToken: "replacement-access-token",
        expiresIn: 900,
        refreshToken: "must-not-be-exposed",
      })
    );

    await expect(
      changePassword("password-change-token", "replacement-password")
    ).rejects.toThrow("unexpected error occurred during change password");

    expect(getAuthToken()).toBeNull();
    expect(authChanges).toHaveBeenCalledOnce();
    expect(authChanges).toHaveBeenCalledWith(false, null);
    unsubscribe();
  });
});

describe("authService.changeCurrentPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthState();
  });

  it("accepts the browser-safe response and keeps the signed-in state", async () => {
    const browserAuthResponse = {
      user: browserUser,
      accessToken: "replacement-access-token",
      expiresIn: 900,
    };
    setAuthToken("existing-access-token");
    vi.clearAllMocks();
    clientMocks.changeCurrentPassword.mockResolvedValue(
      responseEnvelope(browserAuthResponse)
    );

    await expect(
      changeCurrentPassword("current-password", "replacement-password")
    ).resolves.toEqual(browserAuthResponse);

    expect(clientMocks.changeCurrentPassword).toHaveBeenCalledWith({
      changeCurrentPasswordDto: {
        currentPassword: "current-password",
        newPassword: "replacement-password",
      },
    });
    expect(getAuthToken()).toBe("replacement-access-token");
  });

  it("surfaces a rejected current password without clearing the signed-in state", async () => {
    setAuthToken("existing-access-token");
    vi.clearAllMocks();
    clientMocks.changeCurrentPassword.mockRejectedValue({
      response: { status: 401 },
      isAxiosError: true,
    });

    await expect(
      changeCurrentPassword("wrong-password", "replacement-password")
    ).rejects.toThrow("Current password is incorrect");

    expect(getAuthToken()).toBe("existing-access-token");
  });

  it("does not log password values when the mutation fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    clientMocks.changeCurrentPassword.mockRejectedValue(
      new Error("request failed")
    );

    try {
      await expect(
        changeCurrentPassword("current-password", "replacement-password")
      ).rejects.toThrow(
        "An unexpected error occurred during change current password. Please try again."
      );

      expect(consoleError).toHaveBeenCalledWith(
        "Change current password failed",
        { errorType: "Error" }
      );
      expect(consoleError.mock.calls.flat()).not.toContain("current-password");
      expect(consoleError.mock.calls.flat()).not.toContain(
        "replacement-password"
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("authService.logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthState();
  });

  it("waits for server logout before clearing local state and suppressing renewal", async () => {
    setAuthToken("active-access-token");
    vi.clearAllMocks();
    let resolveLogout: (() => void) | undefined;
    clientMocks.logout.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      })
    );

    const logoutPromise = logout();

    expect(clientMocks.logout).toHaveBeenCalledOnce();
    expect(getAuthToken()).toBe("active-access-token");
    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RenewFromServer
    );

    resolveLogout?.();
    await logoutPromise;

    expect(getAuthToken()).toBeNull();
    expect(clientMocks.setAuthToken).toHaveBeenCalledWith(null);
    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RemainSignedOut
    );
  });

  it("lets an in-flight renewal settle before clearing server cookies", async () => {
    setAuthToken("active-access-token");
    vi.clearAllMocks();
    let resolveRenewal:
      | ((value: ReturnType<typeof responseEnvelope>) => void)
      | undefined;
    clientMocks.refreshToken.mockReturnValue(
      new Promise((resolve) => {
        resolveRenewal = resolve;
      })
    );
    clientMocks.logout.mockResolvedValue(responseEnvelope({ message: "ok" }));

    const refreshPromise = refreshAuthToken();
    const logoutPromise = logout();

    expect(clientMocks.logout).not.toHaveBeenCalled();
    await expect(refreshAuthToken()).rejects.toThrow(
      "Cannot renew the browser session while logout is in progress"
    );

    resolveRenewal?.(
      responseEnvelope({
        user: browserUser,
        accessToken: "renewed-access-token",
        expiresIn: 900,
      })
    );
    await refreshPromise;
    await logoutPromise;

    expect(clientMocks.logout).toHaveBeenCalledOnce();
    expect(getAuthToken()).toBeNull();
    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RemainSignedOut
    );
  });

  it("preserves local state until server logout finishes when an in-flight renewal fails", async () => {
    setAuthToken("active-access-token");
    vi.clearAllMocks();
    let rejectRenewal: ((reason: Error) => void) | undefined;
    let resolveLogout: (() => void) | undefined;
    clientMocks.refreshToken.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRenewal = reject;
      })
    );
    clientMocks.logout.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      })
    );

    const refreshPromise = refreshAuthToken();
    const logoutPromise = logout();
    rejectRenewal?.(new Error("renewal failed"));
    await expect(refreshPromise).rejects.toThrow(
      "unexpected error occurred during token refresh"
    );

    expect(clientMocks.logout).toHaveBeenCalledOnce();
    expect(getAuthToken()).toBe("active-access-token");

    resolveLogout?.();
    await logoutPromise;

    expect(getAuthToken()).toBeNull();
  });

  it("preserves local state and renewal eligibility when server logout fails", async () => {
    setAuthToken("active-access-token");
    vi.clearAllMocks();
    clientMocks.logout.mockRejectedValue(new Error("server unavailable"));

    await expect(logout()).rejects.toThrow(
      "unexpected error occurred during logout"
    );

    expect(getAuthToken()).toBe("active-access-token");
    expect(clientMocks.setAuthToken).not.toHaveBeenCalled();
    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RenewFromServer
    );
  });

  it("allows a later successful authentication to reset sign-out suppression", async () => {
    setAuthToken("active-access-token");
    clientMocks.logout.mockResolvedValue(responseEnvelope({ message: "ok" }));
    await logout();
    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RemainSignedOut
    );

    clientMocks.login.mockResolvedValue(
      responseEnvelope({
        user: browserUser,
        accessToken: "new-access-token",
        expiresIn: 900,
      })
    );
    await login({ email: browserUser.email, password: "password" });

    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RenewFromServer
    );
  });

  it("allows a later successful renewal to reset sign-out suppression", async () => {
    setAuthToken("active-access-token");
    clientMocks.logout.mockResolvedValue(responseEnvelope({ message: "ok" }));
    await logout();

    clientMocks.refreshToken.mockResolvedValue(
      responseEnvelope({
        user: browserUser,
        accessToken: "renewed-access-token",
        expiresIn: 900,
      })
    );
    await refreshAuthToken();

    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RenewFromServer
    );
  });

  it("allows successful password completion to reset sign-out suppression", async () => {
    setAuthToken("active-access-token");
    clientMocks.logout.mockResolvedValue(responseEnvelope({ message: "ok" }));
    await logout();

    clientMocks.changePassword.mockResolvedValue(
      responseEnvelope({
        user: browserUser,
        accessToken: "replacement-access-token",
        expiresIn: 900,
      })
    );
    await changePassword("password-change-token", "replacement-password");

    expect(getBrowserSessionContinuityDecision()).toBe(
      BrowserSessionContinuityDecision.RenewFromServer
    );
  });
});
