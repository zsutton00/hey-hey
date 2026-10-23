-- Keep STANDARD proposal scope bounded by user requests and authoritative,
-- non-archived project context. Append to the existing values so the 3-4
-- acceptance-criterion guidance introduced earlier remains intact.

WITH evidence_backed_scope AS (
  SELECT $guidance$

## Evidence-backed scope

Before submitting the proposal, audit every substantive behavior,
implementation decision, scope boundary, and acceptance criterion across the
description, implementation detail, and acceptance criteria. Each claim must
have a basis in the user's request or authoritative, non-archived project
context. Plausibility, completeness, convention, likely edge cases, and general
engineering practice are not independent sources of product scope.

Engineering standards may constrain how authorized work is implemented, but
they may not create additional product behavior. Remove unsupported claims. If
an unsupported claim exposes a genuinely necessary unresolved decision,
surface the gap instead of resolving it silently. Acceptance criteria are a
projection of established scope, not a place to elaborate it.$guidance$ AS value
)
UPDATE "work_item_type"
SET "writing_standards" = jsonb_build_object(
      'create', "writing_standards"->>'create' || evidence_backed_scope.value,
      'edit', "writing_standards"->>'edit' || evidence_backed_scope.value
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM evidence_backed_scope
WHERE "work_item_type"."type_key" = 'STANDARD'
  AND "work_item_type"."is_system" = true
  AND "work_item_type"."lifecycle_status" = 'active';
