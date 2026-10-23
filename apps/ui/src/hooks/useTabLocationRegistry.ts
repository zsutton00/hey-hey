import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  hasOtherTabAt,
  removeMyLocation,
  subscribeToHighlight,
  triggerHighlightEffect,
  writeMyLocation,
} from "../utils/tabLocationRegistry";

/**
 * Mount once at the app-shell level (inside the router).
 *
 * - Keeps this tab's entry in the cross-tab location registry up to date.
 * - Listens for highlight signals targeting this tab's pathname and triggers
 *   the in-page visual effect.
 * - Removes the entry when the tab closes (pagehide) or the component unmounts.
 */
export const useTabLocationRegistry = (): void => {
  const location = useLocation();

  useEffect(() => {
    writeMyLocation(location.pathname, location.search);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const unsubscribe = subscribeToHighlight((pathname) => {
      if (pathname === location.pathname) {
        triggerHighlightEffect();
      }
    });
    return unsubscribe;
  }, [location.pathname]);

  useEffect(() => {
    const handlePageHide = (): void => {
      removeMyLocation();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      removeMyLocation();
    };
  }, []);
};

/**
 * Reactively returns true when any other open tab is at `pathname`.
 * Updates whenever a sibling tab writes to the shared localStorage registry.
 */
export const useHasTabAt = (pathname: string | null): boolean => {
  const [hasTab, setHasTab] = useState<boolean>(
    () => (pathname ? hasOtherTabAt(pathname) : false),
  );

  useEffect(() => {
    if (!pathname) {
      setHasTab(false);
      return;
    }
    setHasTab(hasOtherTabAt(pathname));
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === "heyhey:tabLocations") {
        setHasTab(hasOtherTabAt(pathname));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [pathname]);

  return hasTab;
};
