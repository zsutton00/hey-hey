import type { ServicePlaceChoice } from "../../api";
import { resolveChoice } from "./resolveChoice";

/** What the launch screen has chosen for where the session works. */
export interface LaunchPlaceSelection {
  /** The one choice applied to every Service; null is the default (main folder). */
  sessionChoice: ServicePlaceChoice | null;
  /** Per-Service choices, or null while "Choose per Service" is off. */
  perServiceChoices: Readonly<Record<string, ServicePlaceChoice>> | null;
  /** A Plan's branch. When set, every Service works on it and nothing else can be chosen. */
  lockedBranch: string | null;
}

export interface LaunchPlaces {
  /** One explicit choice per Service. Absent for a Plan-locked launch. */
  servicePlaceChoices?: ServicePlaceChoice[];
  /** The session-wide worktree branch older CLIs understand. */
  worktree?: string;
}

/**
 * The place one Service works. A Service without its own choice (for example
 * one selected after "Choose per Service" was turned on) uses the session-wide
 * choice until the user changes it. The launch screen and the launch both read
 * this, so what is shown is what is sent.
 */
export const placeFor = (
  serviceId: string,
  selection: Pick<LaunchPlaceSelection, "sessionChoice" | "perServiceChoices">,
): ServicePlaceChoice => {
  const own = selection.perServiceChoices?.[serviceId] ?? null;
  const shared = selection.sessionChoice;

  return resolveChoice(serviceId, own ?? (shared && { ...shared, serviceId }));
};

const sharedWorktreeBranch = (
  choices: readonly ServicePlaceChoice[],
): string | null => {
  const [first] = choices;
  if (first?.kind !== "WORKTREE") {
    return null;
  }

  const allShare = choices.every(
    (choice) => choice.kind === "WORKTREE" && choice.branch === first.branch,
  );

  return allShare ? first.branch : null;
};

/**
 * Builds what the launch sends for the selected Services.
 *
 * A Plan-locked launch sends only the session-wide worktree: the Plan's branch
 * may not exist yet, and an explicit per-Service worktree choice must name an
 * existing branch. Otherwise every Service gets an explicit choice (the default
 * is the main folder), and the session-wide `worktree` is added when all
 * Services share one worktree branch so older CLIs behave as before.
 */
export const buildLaunchPlaces = (
  serviceIds: readonly string[],
  selection: LaunchPlaceSelection,
): LaunchPlaces => {
  if (selection.lockedBranch !== null) {
    return { worktree: selection.lockedBranch };
  }

  const servicePlaceChoices = serviceIds.map((serviceId) =>
    placeFor(serviceId, selection),
  );
  const worktree = sharedWorktreeBranch(servicePlaceChoices);

  return {
    servicePlaceChoices,
    ...(worktree !== null ? { worktree } : {}),
  };
};
