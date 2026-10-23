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
] as const;
