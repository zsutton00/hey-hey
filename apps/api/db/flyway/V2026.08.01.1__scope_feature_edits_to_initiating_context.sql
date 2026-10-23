-- Keep FEATURE edits bounded to the work context that initiated them. Topology
-- review can surface conflicts, but it does not authorize unrelated edits.

DO $migration$
DECLARE
  current_edit text;
  scope_anchor text := E'## Roll-up check\n';
  conflicting_roll_up text := E'Features roll up: a parent\'s description implicitly covers everything\nin its children. After an edit, scan parent and child features in the\ntopology. If the change creates a scope conflict — a parent that no\nlonger covers a child, or a child that contradicts a parent — propose\nan edit on the related feature alongside the main edit, or\nflag the ambiguity to the user.';
  scoped_roll_up text := E'Use topology and roll-up review to surface genuine conflicts introduced\nby the scoped edit. A conflict is evidence to flag or clarify; it does\nnot authorize proposing unrelated feature edits automatically.';
BEGIN
  SELECT "writing_standards"->>'edit'
  INTO current_edit
  FROM "work_item_type"
  WHERE "id" = 'c1a70000-0000-0000-0000-000000000002';

  IF current_edit IS NULL THEN
    RAISE EXCEPTION 'FEATURE edit writing standards are missing';
  END IF;

  IF position(scope_anchor IN current_edit) = 0 THEN
    RAISE EXCEPTION 'FEATURE edit guidance scope insertion anchor is missing';
  END IF;

  IF position(conflicting_roll_up IN current_edit) = 0 THEN
    RAISE EXCEPTION 'FEATURE edit guidance roll-up replacement anchor is missing';
  END IF;

  current_edit := replace(
    current_edit,
    scope_anchor,
    E'## Scope to the initiating work\n\nA feature can accumulate design and iteration across a long lifetime.\nScope an edit initiated from a task, plan, design doc, or other bounded\nwork context to the feature content that work actually affects. Preserve\nunrelated feature and design-doc statements—even when they read as\ndefinitive—unless the initiating request establishes that they are\naffected.\n\n## Roll-up check\n'
  );

  current_edit := replace(
    current_edit,
    conflicting_roll_up,
    scoped_roll_up
  );

  UPDATE "work_item_type"
  SET
    "writing_standards" = jsonb_set(
      "writing_standards",
      '{edit}',
      to_jsonb(current_edit),
      false
    ),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = 'c1a70000-0000-0000-0000-000000000002';
END
$migration$;
