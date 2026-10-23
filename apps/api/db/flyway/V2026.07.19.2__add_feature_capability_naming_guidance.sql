-- Extend FEATURE authoring guidance so the what-versus-how distinction applies
-- to names as well as descriptions. Keep this agent-enforced: names remain
-- schema-free, and the examples are illustrative rather than a vocabulary.

DO $migration$
DECLARE
  current_create text;
  current_edit text;
  create_anchor text := E'## Description — what is delivered\n';
  edit_anchor text := E'## Common edit failure modes\n';
BEGIN
  SELECT
    "writing_standards"->>'create',
    "writing_standards"->>'edit'
  INTO current_create, current_edit
  FROM "work_item_type"
  WHERE "id" = 'c1a70000-0000-0000-0000-000000000002';

  IF current_create IS NULL OR current_edit IS NULL THEN
    RAISE EXCEPTION 'FEATURE writing standards are missing';
  END IF;

  IF position(create_anchor IN current_create) = 0 THEN
    RAISE EXCEPTION 'FEATURE create guidance anchor is missing';
  END IF;

  IF position(edit_anchor IN current_edit) = 0 THEN
    RAISE EXCEPTION 'FEATURE edit guidance anchor is missing';
  END IF;

  current_create := replace(
    current_create,
    create_anchor,
    E'## Name — the capability, not the mechanism\n\nThe what-versus-how distinction applies to the feature name as well as\nthe description. Name the delivered capability or user-recognizable\nconcept at this feature\'s level of abstraction. Implementation actions,\ntransport primitives, code components, and internal processing stages\nare task language, not feature names.\n\nUse this rename test: if the title primarily answers "how is this built?"\nor reads naturally as an implementation task, choose the smallest\ncapability-oriented rename that preserves the feature\'s actual scope.\nFor example, prefer "Live Updates" to "Send Updates over WebSockets",\n"Feature Search" to "Build SearchIndexService", and "Searchable Activity"\nto "Normalize Events before Indexing". Conversely, keep concise capability\nnames such as "Event Delivery" or "Agent Observability" when they name a\nstable technical capability beneath the product concept they support.\nThese examples are tests, not a closed vocabulary; hierarchy and tag are\nsupporting signals, not substitutes for judging what the name denotes.\n\n## Description — what is delivered\n'
  );

  current_edit := replace(
    current_edit,
    edit_anchor,
    E'## Name edits\n\nApply the same rename test used at creation: if the current title primarily\nanswers "how is this built?" or reads naturally as an implementation task,\npropose the smallest capability-oriented name that preserves scope. Keep a\nconcise technical name when it denotes a stable capability beneath its\nproduct concept; do not treat tag or placement alone as proof that a name\nis sound.\n\n## Common edit failure modes\n\n- **Mechanism-shaped names survive an otherwise sound edit.** Rename action\n  phrases, transports, code components, and internal processing stages to\n  the capability they deliver without broadening the feature.\n'
  );

  UPDATE "work_item_type"
  SET
    "writing_standards" = jsonb_build_object(
      'create', current_create,
      'edit', current_edit
    ),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = 'c1a70000-0000-0000-0000-000000000002';
END
$migration$;
