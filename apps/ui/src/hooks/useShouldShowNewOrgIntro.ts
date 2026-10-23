import { useCallback, useMemo } from "react";
import { useOrganization } from "@hey-hey/ui-common/context";
import { useProjects } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";

const STORAGE_PREFIX = "heyhey:newOrgIntroSeen:";

const storageKey = (orgId: string): string => `${STORAGE_PREFIX}${orgId}`;

const readSeen = (orgId: string): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey(orgId)) === "1";
  } catch {
    return false;
  }
};

const writeSeen = (orgId: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(orgId), "1");
  } catch {
    // Ignore quota / privacy-mode errors — gate just won't suppress next time.
  }
};

export interface ShouldShowNewOrgIntroResult {
  /** True only when we have enough loaded data to make a decision either way. */
  isReady: boolean;
  /** True when the current user should see the intro right now. */
  shouldShow: boolean;
  /** Mark the intro as seen for the current org so subsequent visits skip it. */
  markSeen: () => void;
}

/**
 * Encodes the working-assumption gate for the new-org intro experience:
 * the current org has zero projects yet (a strong proxy for "first user of a
 * brand-new org" until a members-count signal exists), and the user has not
 * already passed through the intro for this org. Persists the "seen" flag in
 * localStorage so revisits don't replay the scenes.
 */
export function useShouldShowNewOrgIntro(): ShouldShowNewOrgIntroResult {
  const identity = useUserIdentity();
  const { currentOrganization, loading: orgLoading } = useOrganization();
  const orgId = currentOrganization?.id;

  const { projects, isFetched, isReady: projectsReady } = useProjects(orgId, {
    enabled: !!orgId,
  });

  const seen = useMemo(() => (orgId ? readSeen(orgId) : false), [orgId]);

  const isReady = !!identity && !orgLoading && !!orgId && isFetched && projectsReady;

  const shouldShow = isReady && projects.length === 0 && !seen;

  const markSeen = useCallback(() => {
    if (orgId) writeSeen(orgId);
  }, [orgId]);

  return { isReady, shouldShow, markSeen };
}
