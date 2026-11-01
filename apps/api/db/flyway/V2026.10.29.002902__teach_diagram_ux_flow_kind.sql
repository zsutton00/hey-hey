-- Replace only the unchanged canonical predecessor; preserve project overrides.
CREATE FUNCTION pg_temp.ux_flow_previous_diagram_semantics() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $old$## Choosing kind, level, and element roles

Choose the Diagram's kind from what it shows: PROCESS for a user or system flow, DYNAMIC for an interaction sequence between participants, DEPLOYMENT for runtime placement, and ARCHITECTURE for structure. Then choose its level. ARCHITECTURE takes a C4 level: SYSTEM_CONTEXT for the system among its users and neighboring systems, CONTAINER for its separately running applications and data stores, COMPONENT for the parts inside one container, and CODE for the code inside one component. OVERVIEW is valid for every kind and is the level for PROCESS, DYNAMIC, and DEPLOYMENT. Keep GENERAL or OVERVIEW only when no more specific value fits.

A Diagram shows one subject at one level. Do not mix levels in one Diagram: when a subject needs both an overview and detail, author connected Diagrams, with the broader one summarizing the narrower one through a DIAGRAM_REFERENCE element.

Give each element the most specific role from the project-effective role vocabulary that its stated meaning supports: PERSON or AGENT for an actor; SOFTWARE_SYSTEM, CONTAINER, COMPONENT, CODE, DATABASE, or EXTERNAL_SYSTEM for a structural part at the Diagram's level; UI for an interface surface; DECISION for a branch point; DIAGRAM_REFERENCE for an element that summarizes another Diagram. GENERIC is correct for an ordinary action such as "Enter shipping address"; do not force a specific role onto it. Roles and references carry the element's meaning even where a view hides Diagram-level metadata, so author them regardless.

## Connecting elements to the project

Before submitting, check every element whose responsibility is concrete (a screen, a control, a service, a sub-process, a build step) for supporting artifacts. Run a bounded search on that responsibility and read the context of promising candidates. Mockups and Diagrams you proposed earlier in this round are candidates too; when a later proposal in the round revises one, link to the latest proposal. Link only when project evidence establishes the relationship; similar names, a shared word, or proximity are not enough. Never link to an archived or rejected candidate, and never invent a target.

Decide what each relationship means before choosing how to record it:
- The element is the entity (a SERVICE, a TASK-backed item it stands for, or an existing Mockup when the element is that screen): set the element's single canonical reference. Canonical references point only at existing entities.
- The element summarizes another Diagram: use the DIAGRAM_REFERENCE role with a canonical reference to that Diagram.
- An artifact explains or details the element (such as a Mockup illustrating an action or control, or a more detailed Diagram): link from the element with RELATED_TO. It is not the canonical reference. For a Mockup, test whether the element name could replace the Mockup name without changing its meaning: a screen can, an action cannot. Use the Diagram context for ambiguous names: a flow of screens represents screens; a flow of user actions represents steps. If still unclear, link rather than reference. A same-round Mockup is not an existing entity: link the element to its proposal, never use it as a canonical reference.
- A task implements the element: link from the element with FULFILLED_BY to the existing task.
- The element takes part in a Contract: use GUARANTEES, IMPLEMENTS, or CONSUMES according to its explicit responsibility.
- Process flow between elements uses STANDARD, CONDITIONAL, and LOOP, never links to artifacts outside the Diagram.

Link from the element when the target explains or implements that one element. Link from the Diagram only when the target covers the whole subject the Diagram shows. A Diagram-level link never replaces an element link. The allowed link types for each source and target come from the project-effective Diagram definition.

## Worked examples

**Explanatory Mockup.** A PROCESS Diagram has a "Submit checkout" element, and an existing checkout Mockup's submit control has `data-hh-id="submit-order"`. Good: a RELATED_TO link from the "Submit checkout" element to the Mockup whose description cites `data-hh-id="submit-order"`. Bad: making the Mockup the element's canonical reference because "Submit checkout" is an action, not the screen; or leaving the link out because the user did not ask for links.

**Screen element.** A flow of screens has a "Checkout page" element and an existing Checkout page Mockup representing that screen. Good: role UI and canonical reference `{ "entityType": "TASK", "entityId": "<Mockup id>" }`. Bad: only linking the Mockup when the element represents the screen.

**Represented entity.** An ARCHITECTURE Diagram at CONTAINER level has a "Billing Service" element, and the Billing Service SERVICE exists. Good: role CONTAINER and canonical reference `{ "entityType": "SERVICE", "entityId": "<service id>" }`. Bad: a GENERIC element with a RELATED_TO link in place of the reference.

**Nested Diagram.** A "Fulfil order" element summarizes a process that has its own detailed Diagram. Good: role DIAGRAM_REFERENCE and canonical reference `{ "entityType": "TASK", "entityId": "<detailed Diagram id>" }`. Bad: a GENERIC element that only mentions the detailed Diagram in prose.

**Near miss.** A search for "Submit checkout" returns only "Checkout analytics dashboard", which shares a word but not the responsibility, and a rejected "Legacy checkout Mockup" proposal. Good: no link and no invented target, plus one sentence to the user saying why neither candidate was linked. Bad: linking on title similarity, or to a rejected proposal or an archived artifact.$old$
$function$;

CREATE FUNCTION pg_temp.ux_flow_updated_diagram_semantics() RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT $new$## Choosing kind, level, and element roles

Choose the Diagram's kind from what it shows: UX_FLOW for a journey between interface screens, where each element is a Mockup screen and each link is a transition the user triggers; PROCESS for a user or system flow, DYNAMIC for an interaction sequence between participants, DEPLOYMENT for runtime placement, and ARCHITECTURE for structure. Then choose its level. ARCHITECTURE takes a C4 level: SYSTEM_CONTEXT for the system among its users and neighboring systems, CONTAINER for its separately running applications and data stores, COMPONENT for the parts inside one container, and CODE for the code inside one component. OVERVIEW is valid for every kind and is the level for UX_FLOW, PROCESS, DYNAMIC, and DEPLOYMENT. Keep GENERAL or OVERVIEW only when no more specific value fits.

A Diagram shows one subject at one level. Do not mix levels in one Diagram: when a subject needs both an overview and detail, author connected Diagrams, with the broader one summarizing the narrower one through a DIAGRAM_REFERENCE element.

Give each element the most specific role from the project-effective role vocabulary that its stated meaning supports: PERSON or AGENT for an actor; SOFTWARE_SYSTEM, CONTAINER, COMPONENT, CODE, DATABASE, or EXTERNAL_SYSTEM for a structural part at the Diagram's level; UI for an interface surface; DECISION for a branch point; DIAGRAM_REFERENCE for an element that summarizes another Diagram. GENERIC is correct for an ordinary action such as "Enter shipping address"; do not force a specific role onto it. Roles and references carry the element's meaning even where a view hides Diagram-level metadata, so author them regardless.

## UX flow screens and transitions

Use UX_FLOW at OVERVIEW level only. Every element is a screen with its Mockup as canonical reference `{ "entityType": "TASK", "entityId": "<Mockup id>" }`. Every transition is a STANDARD, CONDITIONAL, or LOOP link between screens in this Diagram, with a non-empty `actionLabel` stating the triggering user action; its target is the resulting screen. An action, control, or step on a screen is never its own element: it becomes the label of the transition it causes, or is left out if it leads nowhere new. Several screen elements may share one Mockup when it shows a small state variation; a substantial state gets its own Mockup.

## Connecting elements to the project

Before submitting, check every element whose responsibility is concrete (a screen, a control, a service, a sub-process, a build step) for supporting artifacts. Run a bounded search on that responsibility and read the context of promising candidates. Mockups and Diagrams you proposed earlier in this round are candidates too; when a later proposal in the round revises one, link to the latest proposal. Link only when project evidence establishes the relationship; similar names, a shared word, or proximity are not enough. Never link to an archived or rejected candidate, and never invent a target.

Decide what each relationship means before choosing how to record it:
- The element is the entity (a SERVICE, a TASK-backed item it stands for, or an existing Mockup when the element is that screen): set the element's single canonical reference. Canonical references point only at existing entities, except that a UX_FLOW proposed in the same proposal group as its Mockups uses their reserved ids (`reservedEntityId`).
- The element summarizes another Diagram: use the DIAGRAM_REFERENCE role with a canonical reference to that Diagram.
- An artifact explains or details the element (such as a Mockup illustrating an action or control, or a more detailed Diagram): link from the element with RELATED_TO. It is not the canonical reference. For a Mockup, test whether the element name could replace the Mockup name without changing its meaning: a screen can, an action cannot. Use the Diagram context for ambiguous names: a flow of screens represents screens; a flow of user actions represents steps. If still unclear, link rather than reference. For other kinds, a same-round Mockup is not an existing entity: link the element to its proposal, never use it as a canonical reference. In a UX_FLOW proposed in the same proposal group as its Mockups, use each Mockup's reserved id as the screen's canonical reference instead, with entityType TASK.
- A task implements the element: link from the element with FULFILLED_BY to the existing task.
- The element takes part in a Contract: use GUARANTEES, IMPLEMENTS, or CONSUMES according to its explicit responsibility.
- Process flow between elements uses STANDARD, CONDITIONAL, and LOOP, never links to artifacts outside the Diagram.

Link from the element when the target explains or implements that one element. Link from the Diagram only when the target covers the whole subject the Diagram shows. A Diagram-level link never replaces an element link. The allowed link types for each source and target come from the project-effective Diagram definition.

## Worked examples

**UX flow transition.** Good: UX_FLOW at OVERVIEW level with UI screens "Public landing page" and "Demo project page", each canonically referencing its Mockup, joined by one STANDARD link with `actionLabel` "Clicks Request access". Bad: a GENERIC "Request access" element between the screens, or a transition with no label.

**Explanatory Mockup.** A PROCESS Diagram has a "Submit checkout" element, and an existing checkout Mockup's submit control has `data-hh-id="submit-order"`. Good: a RELATED_TO link from the "Submit checkout" element to the Mockup whose description cites `data-hh-id="submit-order"`. Bad: making the Mockup the element's canonical reference because "Submit checkout" is an action, not the screen; or leaving the link out because the user did not ask for links.

**Screen element.** A flow of screens has a "Checkout page" element and an existing Checkout page Mockup representing that screen. Good: role UI and canonical reference `{ "entityType": "TASK", "entityId": "<Mockup id>" }`. Bad: only linking the Mockup when the element represents the screen.

**Represented entity.** An ARCHITECTURE Diagram at CONTAINER level has a "Billing Service" element, and the Billing Service SERVICE exists. Good: role CONTAINER and canonical reference `{ "entityType": "SERVICE", "entityId": "<service id>" }`. Bad: a GENERIC element with a RELATED_TO link in place of the reference.

**Nested Diagram.** A "Fulfil order" element summarizes a process that has its own detailed Diagram. Good: role DIAGRAM_REFERENCE and canonical reference `{ "entityType": "TASK", "entityId": "<detailed Diagram id>" }`. Bad: a GENERIC element that only mentions the detailed Diagram in prose.

**Near miss.** A search for "Submit checkout" returns only "Checkout analytics dashboard", which shares a word but not the responsibility, and a rejected "Legacy checkout Mockup" proposal. Good: no link and no invented target, plus one sentence to the user saying why neither candidate was linked. Bad: linking on title similarity, or to a rejected proposal or an archived artifact.$new$
$function$;

UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      jsonb_set(writing_standards, '{create}', to_jsonb(replace(writing_standards->>'create', pg_temp.ux_flow_previous_diagram_semantics(), pg_temp.ux_flow_updated_diagram_semantics()))),
      '{edit}', to_jsonb(replace(writing_standards->>'edit', pg_temp.ux_flow_previous_diagram_semantics(), pg_temp.ux_flow_updated_diagram_semantics()))
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND position(pg_temp.ux_flow_previous_diagram_semantics() IN writing_standards->>'create') > 0
  AND position(pg_temp.ux_flow_previous_diagram_semantics() IN writing_standards->>'edit') > 0;
