-- Rewrite the canonical Diagram purpose and authoring guidance so agents find
-- and edit an existing Diagram before creating one, and understand Diagram
-- levels in C4 terms. This guidance replaces the Diagram rules previously
-- hardcoded in the CLI's shared system prompt.
--
-- Also restores the semantic guidance overviews the Diagram cutover dropped
-- when it folded the registered definitions onto the legacy Workflow rows.
-- Only canonical templates still carrying the V2026.09.30.090000 text are
-- rewritten; project-owned overrides remain authoritative.
CREATE FUNCTION pg_temp.diagram_semantics_guidance() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $ws$## Choosing kind, level, and element roles

Choose the Diagram's kind from what it shows: PROCESS for a user or system flow, DYNAMIC for an interaction sequence between participants, DEPLOYMENT for runtime placement, and ARCHITECTURE for structure. Then choose its level. ARCHITECTURE takes a C4 level: SYSTEM_CONTEXT for the system among its users and neighboring systems, CONTAINER for its separately running applications and data stores, COMPONENT for the parts inside one container, and CODE for the code inside one component. OVERVIEW is valid for every kind and is the level for PROCESS, DYNAMIC, and DEPLOYMENT. Keep GENERAL or OVERVIEW only when no more specific value fits.

A Diagram shows one subject at one level. Do not mix levels in one Diagram: when a subject needs both an overview and detail, author connected Diagrams, with the broader one summarizing the narrower one through a DIAGRAM_REFERENCE element.

Give each element the most specific role from the project-effective role vocabulary that its stated meaning supports: PERSON or AGENT for an actor; SOFTWARE_SYSTEM, CONTAINER, COMPONENT, CODE, DATABASE, or EXTERNAL_SYSTEM for a structural part at the Diagram's level; UI for an interface surface; DECISION for a branch point; DIAGRAM_REFERENCE for an element that summarizes another Diagram. GENERIC is correct for an ordinary action such as "Enter shipping address"; do not force a specific role onto it. Roles and references carry the element's meaning even where a view hides Diagram-level metadata, so author them regardless.

## Connecting elements to the project

Before submitting, check every element whose responsibility is concrete (a screen, a control, a service, a sub-process, a build step) for supporting artifacts. Run a bounded search on that responsibility and read the context of promising candidates. Mockups and Diagrams you proposed earlier in this round are candidates too; when a later proposal in the round revises one, link to the latest proposal. Link only when project evidence establishes the relationship; similar names, a shared word, or proximity are not enough. Never link to an archived or rejected candidate, and never invent a target.

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

**Represented entity.** An ARCHITECTURE Diagram at CONTAINER level has a "Billing Service" element, and the Billing Service SERVICE exists. Good: role CONTAINER and canonical reference `{ "entityType": "SERVICE", "entityId": "<service id>" }`. Bad: a GENERIC element with a RELATED_TO link in place of the reference.

**Nested Diagram.** A "Fulfil order" element summarizes a process that has its own detailed Diagram. Good: role DIAGRAM_REFERENCE and canonical reference `{ "entityType": "TASK", "entityId": "<detailed Diagram id>" }`. Bad: a GENERIC element that only mentions the detailed Diagram in prose.

**Near miss.** A search for "Submit checkout" returns only "Checkout analytics dashboard", which shares a word but not the responsibility, and a rejected "Legacy checkout Mockup" proposal. Good: no link and no invented target, plus one sentence to the user saying why neither candidate was linked. Bad: linking on title similarity, or to a rejected proposal or an archived artifact.$ws$
$function$;

CREATE FUNCTION pg_temp.diagram_writing_standards(type_key text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE type_key
    WHEN 'DIAGRAM' THEN jsonb_build_object(
      'create', $ws$## Reuse an existing Diagram first

A Diagram sits under the Feature or task whose subject it shows, and related Diagrams link to it. Before creating one, read that owner's context with `get_context` and its links with `get_edges`, then read each candidate Diagram with `get_workflow`. If an existing Diagram already shows this subject at the level you need, propose an edit to it instead of creating a new Diagram. If one shows the subject at another level, create the new Diagram and connect the two as described below. Tell the user which existing Diagrams you found and how the new Diagram relates to them.

## Placement and description

Parent the Diagram under the Feature whose subject it shows, or under the task it illustrates. Its description states the subject, the level, and any Diagrams it summarizes or hands off to.

$ws$ || pg_temp.diagram_semantics_guidance() || $ws$

## Creating the Diagram and its elements

Set kind and level in the Diagram's `diagramMetadata` section. Create initial elements through the canonical `diagramElements` input, giving each a proposal-local temporary identity, and use that identity in relationship and layout `operations`; flow between elements stays in `operations`. Set each element's role and canonical reference in its `diagramElementMetadata` section. Declare every link from an element in that element's `diagramElements[].edges`, whether the target already exists (`targetEntityType: "TASK"`) or is a proposal from this round (`targetEntityType: "PROPOSAL"` with its `proposalId`). Declare links from the whole Diagram in the Diagram's own `edges`. The complete Diagram, its elements, sections, relationships, and layout are validated together before the proposal is saved.$ws$,
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
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND position('**Same-round target.**' IN writing_standards->>'create') > 0
  AND position('**Same-round target.**' IN writing_standards->>'edit') > 0;

UPDATE work_item_type_template
SET description = $purpose$A visual model of one subject (a process, an interaction between participants, a deployment, or a system's structure) at one level of detail. A system's structure is drawn at one C4 level: system context (the system among its users and neighboring systems), container (its separately running applications and data stores), component (the parts inside one container), or code; other subjects are drawn as an overview. Create one when the subject is clearer as connected elements than as prose, under the Feature it shows.$purpose$,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM'
  AND description = 'A graph-shaped design artifact with explicit kind and abstraction level.';

UPDATE work_item_type_template
SET agent_guidance = jsonb_set(
      COALESCE(agent_guidance, '{}'::jsonb),
      '{overview}',
      to_jsonb(CASE type_key
        WHEN 'DIAGRAM' THEN $overview$A Diagram is project knowledge about how a subject is structured or how it flows. It never implies runtime execution, and its parts are Diagram Elements. Diagrams sit under the Feature or task whose subject they show and link to related Diagrams, so a subject's existing Diagrams are found through that owner's children and links. Each Diagram keeps to one subject at one level; detail at another level belongs in a connected Diagram.$overview$
        ELSE 'A Diagram Element is a placement in a Diagram. Its optional canonical reference identifies a represented entity without cloning it. Role and notation are governed by this effective definition. Contract participation is explicit topology.'
      END),
      true
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND agent_guidance->>'overview' IS NULL;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM work_item_type_template
    WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
      AND (position('## Worked examples' IN writing_standards->>'create') = 0
        OR position('## Worked examples' IN writing_standards->>'edit') = 0
        OR agent_guidance->>'overview' IS NULL)
  ) THEN
    RAISE EXCEPTION 'Canonical Diagram definitions must carry worked examples and a semantic overview';
  END IF;
END
$migration$;
