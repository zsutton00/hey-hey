-- Replace the legacy Workflow authoring standards copied into canonical
-- Diagram definitions during the identity-preserving cutover. Restrict the
-- repair to canonical templates carrying one of the two known canonical/stale
-- values. Project-owned overrides remain authoritative and are never rewritten.
CREATE FUNCTION pg_temp.diagram_writing_standards(type_key text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE type_key
    WHEN 'DIAGRAM' THEN jsonb_build_object(
      'create', $ws$## What a Diagram is

A Diagram is a graph-shaped design artifact with explicit kind and abstraction level. It owns DIAGRAM_ELEMENT children and describes project knowledge; it never implies runtime execution.

## Compound creation

Use the canonical `diagramElements` input for initial Diagram Elements. Give every element a proposal-local temporary identity, then use that same identity in graph relationship and layout operations. The complete Diagram, elements, sections, relationships, and layout are validated as one projected result before proposal persistence.$ws$,
      'edit', $ws$## Editing Diagrams

Edit the complete graph result rather than narrating a diff. Preserve Diagram Element identities, canonical references, structural parentage, relationships, and layout through the generic graph change-set operations.

Use DIAGRAM and DIAGRAM_ELEMENT terminology for every entity. A PROCESS-kind Diagram may describe process flow, but its children remain Diagram Elements rather than workflow steps.$ws$
    )
    WHEN 'DIAGRAM_ELEMENT' THEN jsonb_build_object(
      'create', $ws$## What a Diagram Element is

A DIAGRAM_ELEMENT is one semantic placement inside a Diagram. Its element-local role, label, sections, and presentation belong to the Diagram; an optional canonical reference identifies the represented entity without cloning it.

Create initial elements through the parent Diagram's canonical `diagramElements` input so temporary identities can be shared by relationship and layout operations.$ws$,
      'edit', $ws$## Editing Diagram Elements

Keep one semantic element per item. Preserve its parent Diagram, role, canonical reference, relationships, and stable identity; use graph change-set operations when the edit affects topology or layout.$ws$
    )
  END
$function$;

UPDATE work_item_type_template
SET writing_standards = pg_temp.diagram_writing_standards(type_key),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND (
    writing_standards->>'create' LIKE '## What a workflow%'
    OR writing_standards = jsonb_build_object(
      'create', 'Author Diagram semantics through metadata sections. References preserve canonical entity identities and never imply execution.',
      'edit', 'Review the complete Diagram result. Preserve canonical references, topology and layout.'
    )
  );

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM work_item_type_template
    WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
      AND (writing_standards->>'create' LIKE '## What a workflow%'
        OR writing_standards->>'edit' LIKE '## Editing workflow%')
  ) THEN
    RAISE EXCEPTION 'Canonical Diagram authoring guidance still contains legacy Workflow headings';
  END IF;
END
$migration$;
