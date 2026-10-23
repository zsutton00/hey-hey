import { afterEach, expect, it, vi } from "vitest";
import { startLandingAnalytics } from "./landingAnalytics";

const analyticsWindow = window as typeof window & {
  __HEY_HEY_RUNTIME_CONFIG__?: { goatCounterEndpoint?: string };
  goatcounter?: { count: ReturnType<typeof vi.fn> };
};
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  window.localStorage.clear();
  delete analyticsWindow.__HEY_HEY_RUNTIME_CONFIG__;
  delete analyticsWindow.goatcounter;
  document.body.replaceChildren();
});

it("does not load analytics for an excluded browser", () => {
  analyticsWindow.__HEY_HEY_RUNTIME_CONFIG__ = {
    goatCounterEndpoint: "https://test.goatcounter.com/count",
  };
  window.localStorage.setItem("heyhey.analytics.exclude", "true");
  stop = startLandingAnalytics(document.body);
  expect(document.querySelector("script[data-goatcounter]")).toBeNull();
});

it("suppresses queued visits and clicks when exclusion is enabled during loading", () => {
  analyticsWindow.__HEY_HEY_RUNTIME_CONFIG__ = {
    goatCounterEndpoint: "https://test.goatcounter.com/count",
  };
  const link = document.createElement("a");
  link.href = "/request-access";
  link.addEventListener("click", (event) => event.preventDefault());
  document.body.append(link);
  stop = startLandingAnalytics(document.body);
  link.click();
  window.localStorage.setItem("heyhey.analytics.exclude", "true");
  const count = vi.fn();
  analyticsWindow.goatcounter = { count };
  document.querySelector("script[data-goatcounter]")!.dispatchEvent(new Event("load"));
  link.click();
  expect(count).not.toHaveBeenCalled();
});

it("does not load analytics without environment configuration", () => {
  stop = startLandingAnalytics(document.body);
  expect(document.querySelector("script[data-goatcounter]")).toBeNull();
});

it("counts a homepage visit and each acquisition click, excluding sign-in", () => {
  analyticsWindow.__HEY_HEY_RUNTIME_CONFIG__ = {
    goatCounterEndpoint: "https://test.goatcounter.com/count",
  };
  const root = document.createElement("div");
  root.innerHTML = '<a href="/request-access">Sign up</a><a href="/request-access">Sign up</a><a href="/login">Sign in</a>';
  document.body.append(root);
  stop = startLandingAnalytics(root);
  const script = document.querySelector<HTMLScriptElement>("script[data-goatcounter]")!;
  expect(script.dataset.goatcounter).toBe("https://test.goatcounter.com/count");
  const count = vi.fn();
  analyticsWindow.goatcounter = { count };
  script.dispatchEvent(new Event("load"));
  root.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => event.preventDefault());
    link.click();
  });
  expect(count.mock.calls).toEqual([
    [{ path: "/", title: "Hey Hey" }],
    [{ path: "Signup Click", title: "Signup Click", event: true, no_session: true }],
    [{ path: "Signup Click", title: "Signup Click", event: true, no_session: true }],
  ]);
  stop();
  root.querySelector("a")!.click();
  expect(count).toHaveBeenCalledTimes(3);
  expect(document.querySelector("script[data-goatcounter]")).toBeNull();
});
