-- Append transition-role guidance to canonical Diagram standards and to project
-- copies that still carry the canonical Diagram guidance; other project wording
-- is preserved. Idempotent: rows that already teach transition roles are skipped.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template WHERE type_key = 'DIAGRAM'
  ) THEN
    RAISE EXCEPTION
      'Cannot add transition role guidance; canonical Diagram template is missing';
  END IF;
END
$migration$;

CREATE FUNCTION pg_temp.transition_role_guidance() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $guidance$## Transition roles

A flow transition (a STANDARD, CONDITIONAL or LOOP link) may carry an optional `transitionRole` that says what the transition means: `PRIMARY_PROGRESSION` for the main depicted journey, `ERROR_PATH` for an unsuccessful or exceptional branch, `RECOVERY` for a route back toward usable progress after something went wrong, and `RETURN` for a move back to an earlier step with no failure involved, such as breadcrumb or back navigation. It applies to any Diagram kind with flow links and is separate from the `actionLabel` that describes the triggering action, from the relationship variant and from the predicate.

Set a role only when the Diagram's own statement of the transition supports it. Never infer it from a label, a screen title, position or topology. Outside UX flows, when a transition is uncertain or none of the meanings applies, leave `transitionRole` out: an unclassified transition is valid and stays unclassified. A role is rejected on a link that is not a flow transition.

A Diagram can have several `PRIMARY_PROGRESSION` transitions: every forward step of the intended journey is primary, including each alternative choice from a screen (for example Sign in and Sign up). Do not mark a transition `ERROR_PATH` merely because it is a less common choice. In a `UX_FLOW` Diagram every transition must declare a role, so classify each one; the proposal is rejected otherwise.

Set it with `transitionRole` on `relationship.create`, change it by sending a different value on `relationship.update`, clear it by sending `"transitionRole": null` on `relationship.update`, and omit the field to keep the current role. Example: `{ "op": "relationship.update", "ref": { "refType": "existing", "id": "<link id>" }, "transitionRole": "ERROR_PATH" }`.$guidance$::text;
$function$;

UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      jsonb_set(
        writing_standards,
        '{create}',
        to_jsonb(writing_standards->>'create' || E'\n\n' || pg_temp.transition_role_guidance())
      ),
      '{edit}',
      to_jsonb(writing_standards->>'edit' || E'\n\n' || pg_temp.transition_role_guidance())
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND position('## Transition roles' IN writing_standards->>'create') = 0
  AND position('## Transition roles' IN writing_standards->>'edit') = 0;

UPDATE work_item_type
SET writing_standards = jsonb_set(
      jsonb_set(
        writing_standards,
        '{create}',
        to_jsonb(writing_standards->>'create' || E'\n\n' || pg_temp.transition_role_guidance())
      ),
      '{edit}',
      to_jsonb(writing_standards->>'edit' || E'\n\n' || pg_temp.transition_role_guidance())
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND position('## Connecting elements to the project' IN writing_standards->>'create') > 0
  AND position('## Connecting elements to the project' IN writing_standards->>'edit') > 0
  AND position('## Transition roles' IN writing_standards->>'create') = 0
  AND position('## Transition roles' IN writing_standards->>'edit') = 0;

-- Mockup guidance teaches agents to author UX flow links; they must also set the role.
CREATE FUNCTION pg_temp.mockup_transition_role_note() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $note$Every UX flow transition also needs a `transitionRole` (`PRIMARY_PROGRESSION`, `ERROR_PATH`, `RECOVERY` or `RETURN`) alongside its `actionLabel`; several transitions can be primary when a screen offers several forward choices. See the Diagram guidance on transition roles.$note$::text;
$function$;

UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      jsonb_set(
        writing_standards,
        '{create}',
        to_jsonb(writing_standards->>'create' || E'\n\n' || pg_temp.mockup_transition_role_note())
      ),
      '{edit}',
      to_jsonb(writing_standards->>'edit' || E'\n\n' || pg_temp.mockup_transition_role_note())
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'mockup'
  AND position('Every UX flow transition also needs a `transitionRole`' IN writing_standards->>'create') = 0
  AND position('Every UX flow transition also needs a `transitionRole`' IN writing_standards->>'edit') = 0;
