import type { CapsuleActionRegistration, CapsuleActionTier } from "./types";

const tierRank: Readonly<Record<CapsuleActionTier, number>> = {
  tab: 0,
  page: 1,
  site: 2,
};
const actionGroupRank: Readonly<Record<"page" | "conceptual", number>> = {
  page: 0,
  conceptual: 1,
};

const getTierRank = (tier: CapsuleActionTier): number => tierRank[tier];
const getActionGroupRank = (action: CapsuleActionRegistration): number =>
  actionGroupRank[action.actionGroup];
const getDiscussRank = (action: CapsuleActionRegistration): number =>
  action.id === "discuss" && action.tier !== "site" ? 0 : 1;

const getOrder = (action: CapsuleActionRegistration): number => action.order;

export const sortCapsuleActions = (
  actions: CapsuleActionRegistration[]
): CapsuleActionRegistration[] =>
  actions
    .map((action, registrationIndex) => ({ action, registrationIndex }))
    .sort((a, b) => {
      const discussDiff = getDiscussRank(a.action) - getDiscussRank(b.action);
      if (discussDiff !== 0) {
        return discussDiff;
      }

      const tierDiff = getTierRank(a.action.tier) - getTierRank(b.action.tier);
      if (tierDiff !== 0) {
        return tierDiff;
      }

      const actionGroupDiff =
        getActionGroupRank(a.action) - getActionGroupRank(b.action);
      if (actionGroupDiff !== 0) {
        return actionGroupDiff;
      }

      const orderDiff = getOrder(a.action) - getOrder(b.action);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      // Preserve registration order as final tie-breaker for stable rendering.
      return a.registrationIndex - b.registrationIndex;
    })
    .map(({ action }) => action);
