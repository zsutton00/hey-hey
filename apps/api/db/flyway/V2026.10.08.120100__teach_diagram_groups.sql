-- Teach canonical Diagram authoring to declare optional groups and nested
-- boundaries through the diagramGroups section. Create and edit read the same
-- semantics; only the member reference mechanics differ by mode. Only
-- canonical templates without this section are extended; project-owned
-- overrides remain authoritative.
CREATE FUNCTION pg_temp.diagram_groups_guidance(mode text) RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $ws$

## Groups and boundaries

Use the optional `diagramGroups` section only when grouping adds meaning a reader needs; a Diagram must read well without it. Each group has a stable `id`, an editable `label`, a declared `meaning`, an optional `parentGroupId`, and `members` naming this Diagram's elements. Labels are display text, never identity. Choose the meaning deliberately:
- VISUAL_ASSOCIATION: the elements read together. Layout treats it as a soft preference and may relax it. It never means sequence, parallel execution, ownership, or a relationship.
- STRUCTURAL_BOUNDARY: the elements are factually inside a structure, such as a system or trust boundary. Layout preserves it.
- DEPLOYMENT_BOUNDARY: the placements run inside an environment such as a cloud provider, region, or cluster. Layout preserves it.

Call these groups or boundaries, never containers: a C4 container is an application or data store, so it is an element with role CONTAINER, not an enclosing box. Nest boundaries with `parentGroupId`, for example a region inside a cloud provider, and put each element directly in its innermost factual boundary only. A factual boundary cannot sit inside a visual association group. Visual association groups may overlap.

Membership belongs to the element placement, not the represented entity. When one service is deployed in two regions, author two elements with the same canonical reference, one in each region boundary. Groups never change structural parentage, canonical references, flow, or Contract participation. Never supply coordinates: the renderer draws boundaries around element positions, and editing groups never moves saved positions.

$ws$ || CASE mode
    WHEN 'create' THEN $ws$Author groups with a `section.replace` on the Diagram root for key `diagramGroups`, value `{ "schemaVersion": "diagram-groups.v1", "groups": [...] }`. Reference a new element as `{ "kind": "temporaryWorkItem", "temporaryRef": "<tempId>" }` using its `diagramElements` tempId; it becomes a persisted reference on approval.

**Deployment boundaries.** A DEPLOYMENT Diagram shows the Checkout API running in AWS us-east-1 and GCP europe-west1. Good: boundaries `aws` and `gcp` (DEPLOYMENT_BOUNDARY), `aws-us-east-1` with `parentGroupId: "aws"` and `gcp-europe-west1` with `parentGroupId: "gcp"`, and two Checkout API elements sharing one canonical SERVICE reference, one member of each region. Bad: one Checkout API element in both regions, a box labelled "Container", or a VISUAL_ASSOCIATION group for a region.$ws$
    ELSE $ws$Edit groups by replacing the complete `diagramGroups` section with `section.replace`, keeping every group you are not changing. Reference an existing element as `{ "kind": "persistedWorkItem", "workItemId": "<id>" }` and a new element as `{ "kind": "temporaryWorkItem", "temporaryRef": "<tempId>" }`. When you remove a group, move its child groups to its parent in the same replacement. Deleting an element removes it from its groups automatically.

**Deployment boundaries.** A user asks to show that the Checkout API also runs in GCP europe-west1. Good: add a second Checkout API element with the same canonical SERVICE reference and replace `diagramGroups` so it is a member of a `gcp-europe-west1` DEPLOYMENT_BOUNDARY nested in `gcp`. Bad: adding the existing element to a second region, or changing the service's own parent.$ws$
  END
$function$;

UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      jsonb_set(
        writing_standards,
        '{create}',
        to_jsonb((writing_standards->>'create') || pg_temp.diagram_groups_guidance('create'))
      ),
      '{edit}',
      to_jsonb((writing_standards->>'edit') || pg_temp.diagram_groups_guidance('edit'))
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM'
  AND writing_standards ? 'create'
  AND writing_standards ? 'edit'
  AND position('## Groups and boundaries' IN writing_standards->>'create') = 0
  AND position('## Groups and boundaries' IN writing_standards->>'edit') = 0;

DROP FUNCTION pg_temp.diagram_groups_guidance(text);
