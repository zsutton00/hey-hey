import {
  calculateProvisionalExplorationBudget,
  shouldAllowDirectProvisionalCreate,
} from '../subfacet-lifecycle.policy';

describe('subfacet-lifecycle.policy', () => {
  it('calculates a higher provisional budget near active target (active=20 => budget=8)', () => {
    expect(calculateProvisionalExplorationBudget(20)).toBe(8);
  });

  it('caps provisional budget at 12 for lower active counts', () => {
    expect(calculateProvisionalExplorationBudget(0)).toBe(12);
    expect(calculateProvisionalExplorationBudget(12)).toBe(12);
  });

  it('enforces a minimum exploration lane of 2 at/above active cap', () => {
    expect(calculateProvisionalExplorationBudget(24)).toBe(2);
    expect(calculateProvisionalExplorationBudget(30)).toBe(2);
  });

  it('allows direct provisional create when below budget and below per-run cap', () => {
    expect(
      shouldAllowDirectProvisionalCreate({
        activeCount: 20,
        provisionalCount: 7,
        directCreatesThisRunForCategory: 3,
      }),
    ).toBe(true);
  });

  it('blocks direct provisional create when provisional budget is full', () => {
    expect(
      shouldAllowDirectProvisionalCreate({
        activeCount: 20,
        provisionalCount: 8,
        directCreatesThisRunForCategory: 0,
      }),
    ).toBe(false);
  });
});
