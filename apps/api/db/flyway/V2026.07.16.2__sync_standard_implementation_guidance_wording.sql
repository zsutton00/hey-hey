-- Complete the STANDARD writing-standards sync after V2026.07.16.1.
-- The initial seed used the older "Fill it with your working knowledge"
-- wording; the runtime source of truth now uses the concise actionable form.

UPDATE "work_item_type"
SET "writing_standards" = jsonb_build_object(
      'create',
      replace(
        "writing_standards"->>'create',
        E'separate from the section list. Fill it with your working knowledge of\nhow the work should be done — the relevant files, the patterns to\nfollow, the APIs to call, the architectural constraints to respect. The',
        E'separate from the section list. Use it for concrete implementation\ncontext the task needs — the relevant files, established patterns, APIs,\nand architectural constraints. The'
      ),
      'edit',
      replace(
        "writing_standards"->>'edit',
        E'separate from the section list. Fill it with your working knowledge of\nhow the work should be done — the relevant files, the patterns to\nfollow, the APIs to call, the architectural constraints to respect. The',
        E'separate from the section list. Use it for concrete implementation\ncontext the task needs — the relevant files, established patterns, APIs,\nand architectural constraints. The'
      )
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'STANDARD'
  AND "is_system" = true;
