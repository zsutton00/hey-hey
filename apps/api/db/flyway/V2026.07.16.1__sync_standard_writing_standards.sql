-- Align the persisted STANDARD guidance with WORK_ITEM_WRITING_STANDARDS.
-- V2026.06.12.1 is immutable; this forward-only data migration carries the
-- subsequent authoring-standard changes to existing databases.

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
            "writing_standards"->>'create',
            'the deliverable, embedding code, or recording decision rationale fails the',
            'the deliverable, imagining a diff, or recording decision rationale fails'
          ),
          'Read that feature for the full rule set: length budget, no embedded code,',
          'Read that feature for the full rule set: length budget, no speculative diff,'
        ),
        'duplicate the detail in the description prose. Leave the field empty only when there is genuinely no implementation context to offer.',
        'duplicate the detail in the description prose.' || implementation_choice_guidance.value
      ),
      E'no weasel words ("should", "might", "could"). Non-obvious scope\nboundaries may appear as additional bullets when they exist — omit\nthem when nothing genuinely non-obvious belongs.',
      E'no weasel words ("should", "might", "could"). Normally keep the list to\n3–4 bullets. When it is longer, remove criteria that are obvious,\nredundant, or merely restate the task; do not combine distinct outcomes\ninto denser bullets just to hit the range. Non-obvious scope boundaries\nmay appear as additional bullets when they exist — omit them when nothing\ngenuinely non-obvious belongs.'
    ),
    'edit',
    replace(
      replace(
        "writing_standards"->>'edit',
        E'heading and do not duplicate the detail in the description prose. Leave\nthe field empty only when there is genuinely no implementation context\nto offer.',
        'heading and do not duplicate the detail in the description prose.' || implementation_choice_guidance.value
      ),
      E'- **Acceptance criteria growing into a paragraph.** Keep each AC\n  bullet to one verifiable outcome — one sentence, declarative,\n  no weasel words.',
      E'- **Acceptance criteria sprawl.** Normally keep the list to 3–4 bullets\n  by removing criteria that are obvious, redundant, or merely restate\n  the task. Do not combine distinct outcomes into denser bullets just to\n  hit the range; keep each surviving bullet to one verifiable outcome —\n  one sentence, declarative, no weasel words.'
    )
  ) AS value
  FROM "work_item_type", implementation_choice_guidance
  WHERE "type_key" = 'STANDARD' AND "is_system" = true
)
UPDATE "work_item_type"
SET "writing_standards" = updated_standards.value,
    "updated_at" = CURRENT_TIMESTAMP
FROM updated_standards
WHERE "work_item_type"."type_key" = 'STANDARD'
  AND "work_item_type"."is_system" = true;

