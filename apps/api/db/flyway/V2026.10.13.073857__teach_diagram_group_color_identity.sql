-- Extend only canonical Diagram writing standards; project overrides remain authoritative.
CREATE FUNCTION pg_temp.diagram_group_color_guidance() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $ws$

## Group color identity

Each group may declare an optional `color`: blue, green, orange, purple, red, or teal. Color communicates authored identity, never group meaning: groups representing the same thing should share a color, and different things should use different colors. For example, AWS → GCP → AWS uses the same color for both AWS groups and another for GCP. Omit `color` for stable automatic assignment; do not persist automatically assigned colors. Workflow step colors retain their existing hex-color behavior.

A visual association has a dashed border; structural and deployment boundaries have solid borders regardless of color. Nested groups retain their assigned hue with a stronger tint at each depth. When replacing `diagramGroups`, preserve authored colors of groups you are not changing along with their identities, membership and nesting. Color edits never move saved positions or change canonical references, relationships or Contract participation.
$ws$
$function$;

UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      jsonb_set(writing_standards, '{create}',
        to_jsonb((writing_standards->>'create') || pg_temp.diagram_group_color_guidance())),
      '{edit}',
      to_jsonb((writing_standards->>'edit') || pg_temp.diagram_group_color_guidance())
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM'
  AND writing_standards ? 'create'
  AND writing_standards ? 'edit'
  AND position('## Group color identity' IN writing_standards->>'create') = 0
  AND position('## Group color identity' IN writing_standards->>'edit') = 0;

DROP FUNCTION pg_temp.diagram_group_color_guidance();
