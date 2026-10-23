import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLandingCtaState,
  fetchDemoSandboxAvailable,
  landingCtaByState,
} from "./landingPageCta";

describe("landing CTA state", () => {
  it("adds View demo to the signed-out state without changing its other actions", () => {
    expect(landingCtaByState["signed-out"]).toEqual({
      primary: { label: "Sign up", path: "/request-access" },
      demo: { label: "View demo", path: "/demo" },
      secondary: { label: "Existing User Sign In", path: "/login" },
    });
  });

  it("leaves the authenticated action unchanged and without a demo entry", () => {
    expect(landingCtaByState.authenticated).toEqual({
      primary: { label: "Go to my projects", path: "/home" },
    });
  });

  it("resolves welcome, authenticated and signed-out states", () => {
    expect(getLandingCtaState({ isWelcomeFlow: true, user: null })).toBe(
      "welcome",
    );
    expect(
      getLandingCtaState({ isWelcomeFlow: false, user: { userId: "u" } }),
    ).toBe("authenticated");
    expect(getLandingCtaState({ isWelcomeFlow: false, user: null })).toBe(
      "signed-out",
    );
  });
});

describe("demo availability", () => {
  const answer = (response: Response | Error): ReturnType<typeof vi.fn> => {
    const fetchMock = vi.fn(() =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const available = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify({ data: { available: value } }), { status });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>)
      .__HEY_HEY_RUNTIME_CONFIG__;
  });

  it("asks the API configured for this deployment", async () => {
    (window as unknown as Record<string, unknown>).__HEY_HEY_RUNTIME_CONFIG__ =
      { apiUrl: "https://api.example.test/api/v1/" };
    const fetchMock = answer(available(true));

    await expect(fetchDemoSandboxAvailable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/v1/demo-sandboxes/availability",
    );
  });

  it("is available only when the API says so", async () => {
    answer(available(false));
    await expect(fetchDemoSandboxAvailable()).resolves.toBe(false);
    answer(available("true"));
    await expect(fetchDemoSandboxAvailable()).resolves.toBe(false);
  });

  it("hides the demo when the answer can't be confirmed", async () => {
    answer(available(true, 500));
    await expect(fetchDemoSandboxAvailable()).resolves.toBe(false);
    answer(new Error("offline"));
    await expect(fetchDemoSandboxAvailable()).resolves.toBe(false);
  });
});
