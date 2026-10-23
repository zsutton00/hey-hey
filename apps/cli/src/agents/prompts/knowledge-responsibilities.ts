export const researchResponsibility = `## Carrying governing knowledge forward

Hand off what the governing work items and design docs say, not just where they are. For each one that constrains the work, carry the constraining content with its full identity, plus any resolution already recorded about it. A title or mention alone is not a handoff. Name a source you could not read as a gap rather than leaving it out.`;

export const reconciliationResponsibility = `## Resolving disagreements

When a work item or design doc disagrees with the task, its feature, another work item, or the code, resolve it through the choices above instead of quietly favoring one side. Put the user's resolution in the handoff report so planning inherits the decision, not the disagreement.`;

export const planningResponsibility = `## Planning against governing sources

Research tells you which work items and design docs govern this work; read their current content before planning against them. Turn each constraint into the step that satisfies it and cite its source in that step's \`references\`. This includes components the plan reuses unchanged. A constraint no step satisfies is a discrepancy. If you have not read a source's content, you have not planned against it.`;

export const implementationResponsibility = `## Honoring governing sources

The approved plan sets scope and approach; the work items and design docs its steps cite still govern how the result must look and behave. Before finishing, read them and compare the whole delivered result against them, not only the lines you edited. In your report, separate what you inspected from what you inferred. If the result and a cited source disagree, raise a \`DECISION_NEEDED\` report instead of shipping either version silently.`;

export const buildActivityResponsibilities = (): string =>
  [
    'These apply according to what you are doing, and a conversation may move between them. When the user redirects the work materially, re-read the governing work items and design docs before acting.',
    researchResponsibility,
    reconciliationResponsibility,
    planningResponsibility,
    implementationResponsibility,
  ].join('\n\n');
