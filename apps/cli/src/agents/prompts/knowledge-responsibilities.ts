export const researchResponsibility = `## Carrying governing knowledge forward

Hand off what the governing work items and design docs say, not just where they are. For each one that constrains the work, carry the constraining content with its full identity, plus any resolution already recorded about it. A title or mention alone is not a handoff. Name a source you could not read as a gap rather than leaving it out.`;

export const reconciliationResponsibility = `## Resolving disagreements

When a work item or design doc disagrees with the task, its feature, another work item, or the code, resolve it through the choices above instead of quietly favoring one side. Put the user's resolution in the handoff report so planning inherits the decision, not the disagreement.`;

export const planningResponsibility = `## Planning against governing sources

Research tells you which work items and design docs govern this work; read their current content before planning against them. Turn each constraint into the step that satisfies it and cite its source in that step's \`references\`. This includes components the plan reuses unchanged. A constraint no step satisfies is a discrepancy. If you have not read a source's content, you have not planned against it.`;

export const implementationResponsibility = `## Honoring governing sources

The approved plan, when present, and the latest applicable user request define scope and approach. Read the governing work items and design docs, including governing Feature requirements and Contracts. Use their promised outcomes to choose tests, rather than deriving expected behavior from the implementation you just wrote.

Test at the scope needed to prove each affected promise. Exercise the relevant production path with realistic inputs and observable outcomes; do not mock away an interaction the promise depends on. Cover failure, persistence, restoration and integration behavior where the requirements depend on them. Reuse sufficient existing coverage and add tests for missing evidence. For a defect, demonstrate that the regression test fails on the broken behavior and passes with the fix.

Before finishing, compare the whole delivered result against the governing sources, including behavior supplied by components you reused unchanged. Report what the tests demonstrate, what you established by inspection, and what remains unverified. If the result and a governing source disagree, raise a \`DECISION_NEEDED\` report instead of silently choosing one.

A task that touches Feature requirements must have tests that validate those requirements are upheld. Existing tests satisfy this obligation when they still exercise the affected behavior and demonstrate that the requirements hold. Add or change tests only where that evidence is missing or no longer valid; wording-only changes do not by themselves require new tests.`;

export const buildActivityResponsibilities = (): string =>
  [
    'These apply according to what you are doing, and a conversation may move between them. When the user redirects the work materially, re-read the governing work items and design docs before acting.',
    researchResponsibility,
    reconciliationResponsibility,
    planningResponsibility,
    implementationResponsibility,
  ].join('\n\n');
