-- Keep per-type Contract authoring guidance aligned with the ambient bounded
-- discovery rule without making the type definition the ontology owner.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'CONTRACT'
  ) THEN
    RAISE EXCEPTION
      'Cannot update Contract discovery guidance; canonical Contract template is missing';
  END IF;
END
$migration$;

UPDATE "work_item_type_template"
SET "description" = 'A user-authored, first-class marker that a narrowly stated durable agreement exists at a concrete boundary. A durable authoritative producer interface may qualify before a consumer exists. The Contract is a pointer and notice to the agreement and its authoritative source, never the source of truth for code or payload shape; workflow participation is recorded only for steps evidenced as authoring or enforcing the agreement.',
    "writing_standards" = jsonb_build_object(
      'create',
      '## Before drafting

Apply the ambient Contract-discovery rule to the active boundary before drafting. In a workflow, begin with the current workflow step''s concrete inputs, outputs, and responsibility; outside a workflow, use the narrowest authoritative operation, work item, design artifact, or schema. Require one narrowly stated durable operation, payload, timing rule, semantic promise, availability guarantee, or acknowledgement responsibility; a durable authoritative producer interface can qualify before a consumer exists. Ad hoc interactions, broad communication channels, reference roll-ups, whole services or repositories, and schema mentions without a narrowly stated agreement do not qualify.

Search for an existing Contract after the semantic threshold is met. In workflow cases, connect each evidenced authoring or enforcement participant with `workflow_step DEPENDS_ON Contract`; let the known boundary determine participant count, and exclude steps that merely consume output or occur downstream. Keep flow and `FULFILLED_BY` links separate.

## What a Contract is

A Contract records that a user-authored durable agreement exists across a feature boundary. It is a pointer and notice, not the source of truth for code, payload shape, or runtime behavior.

## Section shape

Contracts are single-section: `description` states the agreement in the user''s terms, names the boundary it makes visible, and points to the authoritative source. Parent the Contract to the feature that owns one side of the agreement; use graph edges to connect the other side.

## Discipline

Do not copy exact schemas, API bodies, or implementation truth into the Contract. Keep children, tags, and due dates off the item.',
      'edit',
      '## Before editing

Re-run the bounded discovery check from the concrete boundary. In a workflow, inspect the active step''s inputs, outputs, and responsibility; outside a workflow, inspect the narrowest authoritative operation, work item, design artifact, or schema. Preserve the Contract only while a narrowly stated durable agreement and authoritative source remain evidenced. A durable authoritative producer interface may remain valid before a consumer exists; ad hoc interactions, broad communication channels, reference roll-ups, whole services or repositories, and schema mentions without a narrowly stated agreement do not qualify.

## Editing Contracts

Edit when the agreement summary, owning feature side, visible boundary, or authoritative source changes. Preserve the pointer model: code remains the source of truth, while the Contract makes the durable agreement discoverable.

## Workflow participation

Reconcile dependencies to every workflow step that currently authors or enforces the agreement, including a step that rejects violations. Use only `workflow_step DEPENDS_ON Contract`; let evidence determine participant count, exclude steps that merely consume output or occur downstream, and keep `STANDARD`, `CONDITIONAL`, `LOOP`, and `FULFILLED_BY` separate.'
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT';
