import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, within } from "@testing-library/react";
import { mountLanding } from "./mountLanding";

let cleanup: (() => void) | undefined;
const stubAvailability = (available: boolean) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { available } }), { status: 200 }),
      ),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup?.();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete (window as unknown as Record<string, unknown>)
    .__HEY_HEY_RUNTIME_CONFIG__;
});

describe("standalone landing", () => {
  it("omits View demo when the demo is switched off", async () => {
    stubAvailability(false);
    const root = document.createElement("div");
    document.body.append(root);
    cleanup = mountLanding(root);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();

    expect(within(root).queryByRole("link", { name: "View demo" })).toBeNull();
    expect(
      within(root).getByRole("link", { name: "Existing User Sign In" }),
    ).toBeInTheDocument();
  });

  it("uses regular links to enter the application and preserves marketing copy", async () => {
    stubAvailability(true);
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query.includes("reduced-motion"),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    const root = document.createElement("div");
    document.body.append(root);
    cleanup = mountLanding(root);
    const page = within(root);
    expect(
      page.getByRole("heading", { name: "A living workspace" }),
    ).toBeInTheDocument();
    expect(page.getAllByRole("link", { name: "Sign up" })).toHaveLength(2);
    expect(
      await page.findByRole("link", { name: "View demo" }),
    ).toHaveAttribute("href", "/demo");
    expect(
      page.getByRole("link", { name: "Existing User Sign In" }),
    ).toHaveAttribute("href", "/login");
    expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(root.querySelector("video")).toBeNull();

    await userEvent.click(
      page.getByRole("button", { name: "Show product video 2" }),
    );
    expect(
      page.getByRole("heading", { name: "Use the plan you already have" }),
    ).toBeInTheDocument();
    expect(
      page.getByRole("button", { name: "Show product video 2" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("loads one video and pauses during interaction", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query.includes("max-width"),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const root = document.createElement("div");
    document.body.append(root);
    cleanup = mountLanding(root);
    expect(root.querySelectorAll("video")).toHaveLength(1);
    expect(play).toHaveBeenCalled();
    fireEvent.mouseEnter(root.querySelector(".landing-videos")!);
    expect(pause).toHaveBeenCalled();
    fireEvent.mouseLeave(root.querySelector(".landing-videos")!);
    expect(play).toHaveBeenCalledTimes(2);
    cleanup();
    cleanup = undefined;
    expect(root).toBeEmptyDOMElement();
  });
});
