/**
 * Shared threshold guidance for the Project Assistant, Feature Sync, and
 * free-form readiness passes. Keep the decision test in one place so research
 * evidence and the downstream verdict use the same boundary.
 */
export const implementationReadinessDecisionGuidance = `Apply this decision test in order:

1. **Settled behavior stays clear.** If authoritative project context already fixes the observable outcome, lifecycle, or boundary, do not require review. Routine fault localization, service ownership tracing, code discovery, and repair mechanics are ordinary implementation discovery, even when the violating boundary is not yet known.
2. **Keep unproven hazards conditional.** A possible Temporal, migration, rollout, or cross-service consequence is an implementation constraint while its triggering path is unproven. Investigate whether the risky path is actually required before asking the user to choose a scope or migration strategy.
3. **Reserve \`REVIEW_REQUIRED\` for a consequential choice.** Emit it only when bounded evidence establishes that implementation must choose among materially different valid outcomes and the available authoritative context does not settle the choice. The alternatives must change observable behavior, scope, or a durable boundary such as data lifecycle, security, isolation, or integration semantics.

Classification fixtures:

- **CLEAR — settled outcome, unknown implementation location.** The Clarify-routing behavior and workflow-aware routing are already recorded, but the violating boundary may be in the producer, platform dispatch, or CLI resolution. Localizing that defect is implementation work; do not ask the user to choose Temporal scope.
- **CLEAR — conditional downstream hazard.** A Temporal migration or drain might matter if investigation proves that an unversioned flow template must change. Preserve that as a constraint and investigate first; it is not a user choice yet.
- **REVIEW_REQUIRED — evidenced unresolved choice.** Authoritative context leaves two or more valid lifecycle, security, isolation, or observable-behavior alternatives, evidence shows the implementation must choose between them, and no requirement, Contract, design decision, or other authoritative context resolves the choice.`;
