type Count = (data: {
  path: string;
  title: string;
  event?: boolean;
  no_session?: boolean;
}) => void;

function isAnalyticsExcluded() {
  try {
    return window.localStorage.getItem("heyhey.analytics.exclude") === "true";
  } catch {
    return false;
  }
}

// This module is imported only by the standalone public homepage.
export function startLandingAnalytics(root: HTMLElement) {
  if (isAnalyticsExcluded()) return () => {};
  const analyticsWindow = window as typeof window & {
    __HEY_HEY_RUNTIME_CONFIG__?: { goatCounterEndpoint?: string };
    goatcounter?: { count?: Count };
  };
  const endpoint = analyticsWindow.__HEY_HEY_RUNTIME_CONFIG__?.goatCounterEndpoint;
  if (!endpoint) return () => {};
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.pathname !== "/count") return () => {};
  } catch {
    return () => {};
  }

  const script = document.createElement("script");
  script.src = "https://gc.zgo.at/count.js";
  script.async = true;
  script.dataset.goatcounter = endpoint;
  script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  let pendingClicks = 0;
  const signup = () => !isAnalyticsExcluded() && analyticsWindow.goatcounter?.count?.({
    path: "Signup Click", title: "Signup Click", event: true, no_session: true,
  });
  script.onload = () => {
    if (isAnalyticsExcluded()) {
      pendingClicks = 0;
      return;
    }
    // Exclude query strings, including any welcome credentials.
    analyticsWindow.goatcounter?.count?.({ path: "/", title: "Hey Hey" });
    while (pendingClicks > 0) {
      pendingClicks -= 1;
      signup();
    }
  };
  const onClick = (event: MouseEvent) => {
    if (isAnalyticsExcluded()) return;
    const link = event.target instanceof Element
      ? event.target.closest("a[href='/request-access']") : null;
    if (!link || !root.contains(link)) return;
    if (analyticsWindow.goatcounter?.count) signup();
    else pendingClicks += 1;
  };
  root.addEventListener("click", onClick);
  document.head.append(script);
  return () => {
    root.removeEventListener("click", onClick);
    script.onload = null;
    script.remove();
    delete analyticsWindow.goatcounter;
  };
}
