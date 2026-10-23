/**
 * Shared bounded discovery contract for consumers that reconcile project MODE
 * bundles while they are already visiting a Feature neighborhood.
 */
export const modeFreshnessDiscoveryGuidance = `## Project MODE freshness (bounded Feature-neighborhood extension)

Extend only the Feature neighborhood already gathered for this work. Do not scan or enumerate the project-wide MODE catalog.

For every visited Feature, and for each of its already-known Feature ancestors, collect MODE candidates through two independent signals:

1. **Structural ownership.** Include MODE work items whose structural parent is the visited Feature. Ownership locates the mode; it does not restrict where the mode can launch. This signal is what keeps a globally runnable mode in sync when its owning Feature changes.
2. **Feature applicability.** Include MODE work items with an outbound MODE-to-Feature \`DEPENDS_ON\` edge whose target is the visited Feature or one of its ancestors. Only this outbound \`DEPENDS_ON\` relationship restricts Feature eligibility, covering the target Feature and its descendants. A MODE with no outbound Feature \`DEPENDS_ON\` is project-global, but it is not relevant to every Feature visit: reconcile it here only through its structural owner.

Structural parentage and \`RELATED_TO\` are non-filtering and must never be reinterpreted as applicability. Exclude MODE work items that match neither ownership nor outbound \`DEPENDS_ON\` applicability. Deduplicate candidates by MODE identity when both signals find the same mode.

Use bounded relationship/search reads against the known Feature ids to discover candidates. Hydrate only the deduplicated MODE bundles needed to judge freshness; do not read unrelated MODE files. Compare the entry \`MODE.md\` instructions and any relevant supporting text files with changed requirements, decisions, and completed work in the gathered Feature context.

Stale MODE content is evidence for the consumer's existing discrepancy and review path. Never directly mutate MODE instructions or supporting files, never approve a MODE change, and never widen the consumer's configured proposal authority.`;
