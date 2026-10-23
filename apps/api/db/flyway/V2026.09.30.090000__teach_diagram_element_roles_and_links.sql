-- Teach canonical Diagram authoring to choose specific kinds, levels, and
-- element roles, and to connect elements to the artifacts that explain,
-- represent, or implement them. Create and edit read the same role, link, and
-- worked-example text; only the declaration mechanics differ by mode. Only
-- canonical templates still carrying the V2026.09.20.2 text are rewritten;
-- project-owned overrides remain authoritative.
CREATE FUNCTION pg_temp.diagram_semantics_guidance() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $ws$## Choosing kind, level, and element roles

Choose the Diagram's kind and level from what it shows. Use PROCESS for a user or system flow, DYNAMIC for an interaction sequence between participants, DEPLOYMENT for runtime placement, and ARCHITECTURE for structure. Only ARCHITECTURE takes a C4 level (SYSTEM_CONTEXT, CONTAINER, COMPONENT, CODE); OVERVIEW is valid for every kind. Keep GENERAL or OVERVIEW only when no more specific value fits.

Give each element the most specific role from the project-effective role vocabulary that its stated meaning supports: PERSON or AGENT for an actor; SOFTWARE_SYSTEM, CONTAINER, COMPONENT, CODE, DATABASE, or EXTERNAL_SYSTEM for a structural part at the Diagram's level; UI for an interface surface; DECISION for a branch point; DIAGRAM_REFERENCE for an element that summarizes another Diagram. GENERIC is correct for an ordinary action such as "Enter shipping address"; do not force a specific role onto it. Roles and references carry the element's meaning even where a view hides Diagram-level metadata, so author them regardless.

## Connecting elements to the project

Before submitting, check every element whose responsibility is concrete (a screen, a control, a service, a sub-process, a build step) for supporting artifacts. Run a bounded search on that responsibility and read the context of promising candidates. Mockups and Diagrams you proposed earlier in this round are candidates too. Link only when project evidence establishes the relationship; similar names, a shared word, or proximity are not enough. Never link to an archived or rejected candidate, and never invent a target.

Decide what each relationship means before choosing how to record it:
- The element is the entity (a SERVICE, or a TASK-backed item it stands for): set the element's single canonical reference. Canonical references point only at existing entities.
- The element summarizes another Diagram: use the DIAGRAM_REFERENCE role with a canonical reference to that Diagram.
- An artifact explains or details the element (a Mockup, a more detailed Diagram): link from the element with RELATED_TO. It is never the canonical reference.
- A task implements the element: link from the element with FULFILLED_BY to the existing task.
- The element takes part in a Contract: use GUARANTEES, IMPLEMENTS, or CONSUMES according to its explicit responsibility.
- Process flow between elements uses STANDARD, CONDITIONAL, and LOOP, never links to artifacts outside the Diagram.

Link from the element when the target explains or implements that one element. Link from the Diagram only when the target covers the whole subject the Diagram shows. A Diagram-level link never replaces an element link. The allowed link types for each source and target come from the project-effective Diagram definition.

## Worked examples

**Explanatory Mockup.** A PROCESS Diagram has a "Submit checkout" element, and an existing checkout Mockup's submit control has `data-hh-id="submit-order"`. Good: a RELATED_TO link from the "Submit checkout" element to the Mockup whose description cites `data-hh-id="submit-order"`. Bad: making the Mockup the element's canonical reference, or leaving the link out because the user did not ask for links.

**Same-round target.** The same element, but the checkout Mockup (or a detailed checkout Diagram) was proposed earlier in this round and is not approved yet. Good: a link from the element to that proposal, with `targetEntityType: "PROPOSAL"` and its `proposalId`. Bad: a proposal group, or skipping the link because the target is not approved. When the round revises that Mockup through a new proposal, link to the new proposal; links to the old proposal are not carried forward.

**Whole-Diagram target.** An onboarding Diagram, and an existing onboarding storyboard Mockup that covers every step it shows. Good: a RELATED_TO link from the Diagram itself. A "Verify email" Mockup that explains only one step still gets its own link from the "Verify email" element. Bad: a Diagram-level link standing in for an element link.

**Represented entity.** An ARCHITECTURE Diagram at CONTAINER level has a "Billing Service" element, and the Billing Service SERVICE exists. Good: role CONTAINER and canonical reference `{ "entityType": "SERVICE", "entityId": "<service id>" }`. Bad: a GENERIC element with a RELATED_TO link in place of the reference.

**Nested Diagram.** A "Fulfil order" element summarizes a process that has its own detailed Diagram. Good: role DIAGRAM_REFERENCE and canonical reference `{ "entityType": "TASK", "entityId": "<detailed Diagram id>" }`. Bad: a GENERIC element that only mentions the detailed Diagram in prose.

**Implementation evidence.** An existing task, "Build checkout submission endpoint", builds the "Submit checkout" step. Good: a FULFILLED_BY link from the element to that task. Bad: the task as the element's canonical reference, or a RELATED_TO link. FULFILLED_BY targets existing tasks, not proposals.

**Near miss.** A search for "Submit checkout" returns only "Checkout analytics dashboard", which shares a word but not the responsibility, and a rejected "Legacy checkout Mockup" proposal. Good: no link and no invented target, plus one sentence to the user saying why neither candidate was linked. Bad: linking on title similarity, or to a rejected proposal or an archived artifact.$ws$
$function$;

CREATE FUNCTION pg_temp.diagram_writing_standards(type_key text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE type_key
    WHEN 'DIAGRAM' THEN jsonb_build_object(
      'create', $ws$## What a Diagram is

A Diagram is a graph-shaped design artifact with explicit kind and abstraction level. It owns DIAGRAM_ELEMENT children and describes project knowledge; it never implies runtime execution.

## Compound creation

Use the canonical `diagramElements` input for initial Diagram Elements. Give every element a proposal-local temporary identity, then use that same identity in graph relationship and layout operations. The complete Diagram, elements, sections, relationships, and layout are validated as one projected result before proposal persistence.

$ws$ || pg_temp.diagram_semantics_guidance() || $ws$

## Declaring element meaning and links when creating

Set kind and level in the Diagram's `diagramMetadata` section, and each element's role and canonical reference in its `diagramElementMetadata` section. Declare every link from an element in that element's `diagramElements[].edges`, whether the target already exists (`targetEntityType: "TASK"`) or is a proposal from this round (`targetEntityType: "PROPOSAL"` with its `proposalId`). Declare links from the whole Diagram in the Diagram's own `edges`. Flow between elements stays in `operations`.$ws$,
      'edit', $ws$## Editing Diagrams

Edit the complete graph result rather than narrating a diff. Preserve Diagram Element identities, canonical references, structural parentage, relationships, and layout through the generic graph change-set operations.

Use DIAGRAM and DIAGRAM_ELEMENT terminology for every entity. A PROCESS-kind Diagram may describe process flow, but its children remain Diagram Elements rather than workflow steps.

$ws$ || pg_temp.diagram_semantics_guidance() || $ws$

## Declaring element meaning and links when editing

Read the current Diagram first and reuse each element's persisted `id`. Change a role or canonical reference with `section.replace` on that element's `diagramElementMetadata`, keeping every value you are not changing. Link an element to an existing target with a `relationship.create` operation whose source is the element and whose target is `{ refType: "existing", id }`. Link an element to a proposal from this round with an outer edge to that `proposalId`, identifying the element with `sourceRef`. Declare links from the whole Diagram in the Diagram's own `edges`. Do not recreate, re-parent, or unlink existing elements to add meaning.$ws$
    )
    WHEN 'DIAGRAM_ELEMENT' THEN jsonb_build_object(
      'create', $ws$## What a Diagram Element is

A DIAGRAM_ELEMENT is one semantic placement inside a Diagram. Its element-local role, label, sections, and presentation belong to the Diagram; an optional canonical reference identifies the represented entity without cloning it.

Create initial elements through the parent Diagram's canonical `diagramElements` input so temporary identities can be shared by relationship and layout operations. Each element declares its own links in its `edges` entry.

$ws$ || pg_temp.diagram_semantics_guidance(),
      'edit', $ws$## Editing Diagram Elements

Keep one semantic element per item. Preserve its parent Diagram, role, canonical reference, relationships, and stable identity; use graph change-set operations when the edit affects topology or layout. Change a role or canonical reference by replacing `diagramElementMetadata` in full, and link to an existing target with a `relationship.create` operation sourced from the element.

$ws$ || pg_temp.diagram_semantics_guidance()
    )
  END
$function$;

UPDATE work_item_type_template
SET writing_standards = pg_temp.diagram_writing_standards(type_key),
    updated_at = CURRENT_TIMESTAMP
WHERE (type_key = 'DIAGRAM'
    AND writing_standards->>'create' LIKE '## What a Diagram is%'
    AND writing_standards->>'edit' LIKE '## Editing Diagrams%')
  OR (type_key = 'DIAGRAM_ELEMENT'
    AND writing_standards->>'create' LIKE '## What a Diagram Element is%'
    AND writing_standards->>'edit' LIKE '## Editing Diagram Elements%');

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM work_item_type_template
    WHERE ((type_key = 'DIAGRAM' AND writing_standards->>'create' LIKE '## What a Diagram is%')
        OR (type_key = 'DIAGRAM_ELEMENT' AND writing_standards->>'create' LIKE '## What a Diagram Element is%'))
      AND (position('## Worked examples' IN writing_standards->>'create') = 0
        OR position('## Worked examples' IN writing_standards->>'edit') = 0)
  ) THEN
    RAISE EXCEPTION 'Canonical Diagram create and edit guidance must carry the worked examples';
  END IF;
END
$migration$;
