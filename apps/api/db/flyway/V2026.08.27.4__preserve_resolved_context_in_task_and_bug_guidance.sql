-- Preserve grounded decisions and investigation findings in the canonical
-- STANDARD and BUG authoring guidance delivered through get_tool_guidance.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT required.type_key
    FROM (VALUES ('STANDARD'), ('BUG')) AS required(type_key)
    LEFT JOIN "work_item_type_template" AS template
      ON template."type_key" = required.type_key
    WHERE template."type_key" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot preserve resolved authoring context; canonical STANDARD or BUG template is missing';
  END IF;
END
$migration$;

WITH guidance(type_key, addition) AS (
  VALUES
    (
      'STANDARD',
      $standard_guidance$

## Preserve resolved context

Preserve every grounded, user-assented system-design and implementation decision required for a future agent to continue without the source conversation. This includes consequential choices about ownership, interfaces and boundary agreements, state representations, algorithms, constraints, and the rationale for those choices. Do not compress resolved work into vague outcome prose or reopen settled decisions.

Grounded context preservation takes precedence over ordinary concision, paragraph-count, and acceptance-criterion-count guidance when the detail is material. The evidence-backed scope rule still applies: preserve only content established by the user's request or authoritative, non-archived project context, and never invent behavior or detail.$standard_guidance$
    ),
    (
      'BUG',
      $bug_guidance$

## Preserve resolved investigation context

Preserve every grounded investigation result required for a future agent to continue without the source conversation. This includes reproduction evidence, observed behavior and conditions, debugging observations, investigation results, an established root cause or narrowed hypotheses, materially useful rejected explanations, affected components and boundaries, and the agreed fix direction. Do not summarize away evidence or erase rejected explanations that materially narrow the remaining work.

Grounded context preservation takes precedence over ordinary concision and paragraph-count guidance when the detail is material. The evidence-backed scope rule still applies: preserve only content established by the user's request or authoritative, non-archived project context, and never invent behavior or detail.$bug_guidance$
    )
)
UPDATE "work_item_type_template" AS template
SET "writing_standards" = jsonb_build_object(
      'create', template."writing_standards"->>'create' || guidance.addition,
      'edit', template."writing_standards"->>'edit' || guidance.addition
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM guidance
WHERE template."type_key" = guidance.type_key;
