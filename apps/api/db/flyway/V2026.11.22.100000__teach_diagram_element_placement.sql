-- Append element-placement guidance to canonical Diagram standards and to
-- project copies that still carry the canonical Diagram guidance; other
-- project wording is preserved. Idempotent: rows that already teach
-- placement are skipped.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template WHERE type_key = 'DIAGRAM'
  ) THEN
    RAISE EXCEPTION
      'Cannot add placement guidance; canonical Diagram template is missing';
  END IF;
END
$migration$;

CREATE FUNCTION pg_temp.placement_guidance() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $guidance$## Placing elements

Saved positions are the layout people see. When you create a Diagram, or when the user asks you to rearrange one, place every element yourself with `layout.replace` and list every element in `layoutBoundary`. Do not omit the layout and leave placement to the viewer.

When you edit an existing Diagram for any other reason (correcting a label, changing a role, adding a link, editing a description), leave the layout alone: send no `layout.replace`, because the saved coordinates may be the user's own arrangement. If you add or remove an element, `layout.replace` takes the complete set, so repeat every element you are not moving at its current coordinates unchanged. Give the new element a position following the rules below. If it lands between existing elements, move only the elements that must shift to make room (for example, push everything to its right one column over) so the rules still hold, and leave the rest where they are. If there is free space for it, move nothing. When you remove an element, close the gap only if it leaves the main progression broken or a group box spanning empty space; otherwise leave the others in place.

Units: a position is the element's top-left corner in pixels at the medium display size; the viewer scales it to other sizes. An element is 140 wide and 140 tall. Use 300 between column origins and 220 between row origins, which leaves room for transition labels. A group box adds 24 of padding on every side and a 24 label strip on top, so keep at least 80 between one group box and the next.

Rules:
- Run the main journey (the `PRIMARY_PROGRESSION` transitions) left to right along one row, one column per step. Never run it right to left or fold it back on itself.
- Put a branch on a row below the step it leaves, centered between the elements it feeds. Put error and recovery paths on the lowest rows.
- Keep each group's members adjacent in their own block, and keep every element that is not a member outside the group's box. Place a group's members so its box does not touch another group's box.
- No element may overlap another element or a group box.
- A transition that returns to an earlier step may cross the Diagram; accept that rather than bending the placement around it.

Example. A request is raised, decided by whom may answer, held by the monitor or handed to the user, then settled and applied. Good: raised, who may answer, monitor holds, monitor decides, settle and apply in one left-to-right row at y 0, x 0, 300, 600, 900, 1200, 1500; the user-holds group in its own block on the row below, 80 clear of the monitor group, with its two answer screens stacked beside the hand-off step. Bad: the same elements in the viewer's automatic arrangement, or a group member sitting inside another group's box.$guidance$::text;
$function$;

UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      jsonb_set(
        writing_standards,
        '{create}',
        to_jsonb(writing_standards->>'create' || E'\n\n' || pg_temp.placement_guidance())
      ),
      '{edit}',
      to_jsonb(writing_standards->>'edit' || E'\n\n' || pg_temp.placement_guidance())
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND position('## Placing elements' IN writing_standards->>'create') = 0
  AND position('## Placing elements' IN writing_standards->>'edit') = 0;

UPDATE work_item_type
SET writing_standards = jsonb_set(
      jsonb_set(
        writing_standards,
        '{create}',
        to_jsonb(writing_standards->>'create' || E'\n\n' || pg_temp.placement_guidance())
      ),
      '{edit}',
      to_jsonb(writing_standards->>'edit' || E'\n\n' || pg_temp.placement_guidance())
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND position('## Connecting elements to the project' IN writing_standards->>'create') > 0
  AND position('## Connecting elements to the project' IN writing_standards->>'edit') > 0
  AND position('## Placing elements' IN writing_standards->>'create') = 0
  AND position('## Placing elements' IN writing_standards->>'edit') = 0;
