import { useCallback, useLayoutEffect } from "react";
import { NavigationType, useNavigate } from "react-router-dom";
import { WebPathService } from "@hey-hey/ui-common/services";
import { ArchiveHistory, parseArchiveHistory } from "./archiveNavigation";

const storageKey = "heyhey.archive-history";
const entryKey = "heyheyArchiveEntry";
function readHistory(): ArchiveHistory {
  try {
    return parseArchiveHistory(sessionStorage.getItem(storageKey));
  } catch (error) {
    console.warn("Archive navigation history unavailable", error);
    return new ArchiveHistory();
  }
}
const history = readHistory();

// Observe the browser boundary because shallow nuqs changes bypass the router
// and can push another entry while retaining React Router's location key.
export function useArchiveHistory(): void {
  useLayoutEffect(() => {
    const browserHistory = window.history;
    const originalPush = browserHistory.pushState;
    const originalReplace = browserHistory.replaceState;
    const record = (action: NavigationType) => {
      history.record(
        {
          key: browserHistory.state[entryKey],
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
          state: null,
        },
        action,
      );
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(history.snapshot()));
      } catch (error) {
        console.warn("Archive navigation history could not be saved", error);
      }
    };
    const ensureEntry = () => {
      if (!browserHistory.state?.[entryKey]) {
        originalReplace.call(
          browserHistory,
          { ...browserHistory.state, [entryKey]: crypto.randomUUID() },
          "",
        );
      }
    };
    ensureEntry();
    record(NavigationType.Pop);
    browserHistory.pushState = function (data, unused, url) {
      originalPush.call(
        this,
        { ...data, [entryKey]: crypto.randomUUID() },
        unused,
        url,
      );
      record(NavigationType.Push);
    };
    browserHistory.replaceState = function (data, unused, url) {
      const key = browserHistory.state?.[entryKey] ?? crypto.randomUUID();
      originalReplace.call(this, { ...data, [entryKey]: key }, unused, url);
      record(NavigationType.Replace);
    };
    const handlePopState = () => {
      ensureEntry();
      record(NavigationType.Pop);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      browserHistory.pushState = originalPush;
      browserHistory.replaceState = originalReplace;
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);
}

export function useArchiveNavigation(projectId: string) {
  const navigate = useNavigate();
  return useCallback(
    (itemId: string) => {
      if (history.previous(itemId)) {
        navigate(-1);
        return;
      }
      navigate(WebPathService.project(projectId), { replace: true });
    },
    [navigate, projectId],
  );
}
