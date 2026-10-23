/**
 * Wire-format alias normalizer for mention/edge type tokens.
 *
 * Producers (humans typing @[feature:id], LLMs filling proposal edge JSON
 * with targetEntityType: 'feature') sometimes use product-facing aliases
 * that don't exist in the EntityType enum. The platform models these as
 * tasks with a typeKind discriminator, so all of feature/goal/bug must
 * resolve to the same canonical wire form: `task`.
 *
 * The helper returns the canonical lowercase wire string (the form used
 * by @[type:id] tokens — `task`, `design-doc`, `proposal`, ...). Callers
 * that need the uppercase ProposalEdgeTargetType / EntityType lift this
 * string into their own enum at the boundary.
 *
 * Distinct from `normalizeMentionType` in
 * src/services/llm/placeholders/registries/standard-placeholders.registry.ts
 * which goes the opposite direction (EntityType -> wire string).
 */
export function normalizeMentionTypeAlias(rawType: string): string {
  const lowered = rawType.toLowerCase().replace(/_/g, '-');
  switch (lowered) {
    case 'feature':
    case 'goal':
    case 'bug':
    case 'plan':
    case 'plan-stage':
      return 'task';
    default:
      return lowered;
  }
}
