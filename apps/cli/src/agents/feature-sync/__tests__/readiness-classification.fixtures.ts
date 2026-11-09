export const readinessClassificationFixtures = [
  {
    id: 'settled-routing-fault-localization',
    expectedState: 'CLEAR',
    label: 'settled outcome, unknown implementation location',
  },
  {
    id: 'conditional-temporal-hazard',
    expectedState: 'CLEAR',
    label: 'conditional downstream hazard',
  },
  {
    id: 'evidenced-consequential-choice',
    expectedState: 'REVIEW_REQUIRED',
    label: 'evidenced unresolved choice',
  },
  {
    id: 'blocked-by-undecided-dependency',
    expectedState: 'REVIEW_REQUIRED',
    label: "blocked by another item's undecided design",
  },
] as const;
