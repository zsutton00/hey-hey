-- Complete the STANDARD writing-standards sync after the earlier targeted
-- replacements left several historical line-wrapping variants unchanged.
-- Keep this forward-only: V2026.07.16.1 may already be applied.

WITH implementation_choice_guidance AS (
  SELECT $guidance$

Before leaving the field empty or merely naming files, apply this review
test: could materially different types, interfaces, ownership models,
state representations, algorithms, or boundary agreements satisfy the
task prose? If yes, expose the chosen shape here so a reviewer can catch
the wrong approach before implementation begins.

Use the smallest concrete representation that makes the choice legible.
That may be a compact type or interface sketch, pseudocode, a state table,
an example payload, or plain structural notes. Compact illustrative code
is allowed when it clarifies the design; no format or fenced block is
required. These forms are examples, not a checklist or a reason to invent
structure.

Paired examples (tests, not templates):
- **Consequential data shape.** Show the selected discriminated shape or
  state representation when another shape would change validation,
  ownership, or consumers; do not invent a wrapper schema or enumerate
  every incidental field merely to look concrete.
- **Consequential algorithm.** State the ordering, identity key, state
  transition, or compact pseudocode when alternatives change behavior;
  do not sketch an imagined function body or speculative diff.
- **Existing-pattern reuse.** When the work follows an established pattern
  and no material choice remains, name that pattern and implementation
  point tersely; do not add a ceremonial type sketch or code block.
- **Contract-governed boundary.** When work changes behavior, payload
  shape, timing, semantics, or responsibility across feature ownership
  boundaries, check for an applicable Contract. If one applies, cite it
  and expose the concrete seam that fulfills it without restating the
  agreement. Topical overlap alone does not make a Contract applicable;
  surface a genuinely missing durable agreement separately rather than
  manufacturing an association.

Reject exhaustive symbol inventories, invented schemas, speculative
diffs, and incidental implementation noise. The goal is the minimum
evidence needed to distinguish materially different approaches.$guidance$ AS value
), updated_standards AS (
  SELECT jsonb_build_object(
    'create',
    replace(
      replace(
        replace(
          replace(
            replace(
              "writing_standards"->>'create',
              E'fails\nreview pipeline',
              E'fails\nthe review pipeline'
            ),
            'surface that materializes one.',
            E'surface that materializes one. For `SUPERSEDES`, target the predecessor\nwork item being replaced; approval performs the status change and successor\nedge together.'
          ),
          E'separate from the section list. Fill it with your working knowledge of\nhow the work should be done — the relevant files, the patterns to\nfollow, the APIs to call, the architectural constraints to respect. The',
          E'separate from the section list. Use it for concrete implementation\ncontext the task needs — the relevant files, established patterns, APIs,\nand architectural constraints. The'
        ),
        E'duplicate the detail in the description prose. Leave the field empty\nonly when there is genuinely no implementation context to offer.',
        'duplicate the detail in the description prose.' || implementation_choice_guidance.value
      ),
      'duplicate the detail in the description prose. Leave the field empty only when there is genuinely no implementation context to offer.',
      'duplicate the detail in the description prose.' || implementation_choice_guidance.value
    ),
    'edit',
    replace(
      replace(
        replace(
          replace(
            "writing_standards"->>'edit',
            'field materializes one.',
            E'field materializes one. For `SUPERSEDES`, target the predecessor work item\nbeing replaced; approval performs the status change and successor edge\ntogether.'
          ),
          E'separate from the section list. Fill it with your working knowledge of\nhow the work should be done — the relevant files, the patterns to\nfollow, the APIs to call, the architectural constraints to respect. The',
          E'separate from the section list. Use it for concrete implementation\ncontext the task needs — the relevant files, established patterns, APIs,\nand architectural constraints. The'
        ),
        E'heading and do not duplicate the detail in the description prose. Leave\nthe field empty only when there is genuinely no implementation context\nto offer.',
        'heading and do not duplicate the detail in the description prose.' || implementation_choice_guidance.value
      ),
      'heading and do not duplicate the detail in the description prose. Leave the field empty only when there is genuinely no implementation context to offer.',
      'heading and do not duplicate the detail in the description prose.' || implementation_choice_guidance.value
    )
  ) AS value
  FROM "work_item_type", implementation_choice_guidance
  WHERE "type_key" = 'STANDARD'
    AND "is_system" = true
)
UPDATE "work_item_type"
SET "writing_standards" = updated_standards.value,
    "updated_at" = CURRENT_TIMESTAMP
FROM updated_standards
WHERE "work_item_type"."type_key" = 'STANDARD'
  AND "work_item_type"."is_system" = true;

DO $$
DECLARE
  create_hash text;
  edit_hash text;
BEGIN
  SELECT
    md5("writing_standards"->>'create'),
    md5("writing_standards"->>'edit')
  INTO create_hash, edit_hash
  FROM "work_item_type"
  WHERE "type_key" = 'STANDARD'
    AND "is_system" = true;

  IF create_hash IS NULL OR edit_hash IS NULL THEN
    RAISE EXCEPTION
      'STANDARD writing standards are missing after synchronization';
  END IF;

  IF create_hash <> 'c2c26dc8d1f37a80ebbfd40ed3885289'
     OR edit_hash <> '1e0ddcbb9e302ea071d1100d4ed85a8c' THEN
    RAISE EXCEPTION
      'STANDARD writing standards did not converge: create %, edit %',
      create_hash,
      edit_hash;
  END IF;
END
$$;
