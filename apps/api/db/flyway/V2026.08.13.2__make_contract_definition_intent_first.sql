-- Make Contract creation intent-first: provider-owned promise is the threshold,
-- while consumer cardinality and workflow participation remain downstream facts.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'CONTRACT'
  ) THEN
    RAISE EXCEPTION
      'Cannot update intent-first Contract definition; canonical Contract template is missing';
  END IF;
END
$migration$;

UPDATE "work_item_type_template"
SET "description" = $contract_description$
A Contract is a user-authored, first-class marker that a provider intentionally offers a stable interaction point and promises defined behavior when stated conditions are met. The promise may have zero, one, or many consumers: consumer count does not create, validate, or invalidate the Contract. The Contract points to the agreement and its authoritative source, never replacing code or payload truth.

Workflows are a primary discovery and anchoring surface because steps expose designed inputs, outputs, handoffs, and enforcement responsibilities, but workflow participation is not required for Contract validity. A deliberate REST or CRUD operation, state-machine entry, callback, event, timing, availability, or acknowledgement promise may be contractual without a useful workflow. Cross-feature work, dependencies, schemas, endpoints, and shared implementation remain ordinary mentions or typed edges unless provider-owned design intent records a durable guarantee. In a workflow, only steps evidenced as authoring or enforcing the agreement participate.
$contract_description$,
    "writing_standards" = jsonb_build_object(
      'create',
      $contract_create$
## Before drafting

Use this order:

1. Identify evidence that the provider deliberately offers a stable interaction point.
2. State the conditions and the behavior the provider promises when those conditions are met.
3. Identify the narrowest concrete owner or enforcing anchor for that promise.
4. Search for an existing Contract; draft one only when the durable provider-owned promise is evidenced and no existing Contract covers it.

Consumer presence is a downstream fact, not the creation threshold: a provider-owned promise remains a Contract with zero, one, or many consumers. Ordinary cross-feature work, dependencies, schemas, endpoints, shared implementation, broad services or repositories, communication channels, and reference-only topology do not establish provider intent by themselves; keep those cases as inline mentions and ordinary typed edges unless recorded design intent establishes a stable guarantee.

A state-machine entry is a positive example when its provider promises that valid initial state starts the machine under defined semantics, and may separately promise how accepted events advance it under defined transitions. That promise is contractual even before a consumer exists and even without a workflow. A deliberate REST or CRUD operation is likewise contractual when its provider intentionally offers the operation and promises defined behavior under stated conditions; a workflow is not required.

A task that happens to update two features or reuse a schema is a negative example: it remains ordinary implementation topology unless an owner has deliberately recorded a durable guarantee. Workflow authoring creates a strong discovery moment, but it never proves that every boundary step is contractual. When a workflow step authors or enforces the agreement, link that responsible workflow_step with `DEPENDS_ON`; keep flow and `FULFILLED_BY` links separate, and do not link steps that merely consume output or occur downstream.

## What a Contract is

A Contract records a user-authored durable agreement at a concrete boundary. It is a pointer and notice to the agreement and authoritative source, never the source of truth for code, payload shape, or runtime behavior.

## Section shape

Contracts are single-section: `description` states the agreement in the user's terms, names the boundary it makes visible, and points to the authoritative source. Parent the Contract to the feature that owns one side of the agreement; use graph edges to connect the other side.

## Discipline

Do not copy exact schemas, API bodies, or implementation truth into the Contract. Keep children, tags, and due dates off the item.
$contract_create$,
      'edit',
      $contract_edit$
## Before editing

Re-check the provider's deliberate offer of a stable interaction point, the stated conditions, the promised behavior, and the narrowest owning or enforcing anchor before changing the Contract. Preserve the provider's intent and offered interaction while that durable guarantee remains evidenced.

Adding or removing consumers alone does not create, delete, validate, invalidate, or semantically change a Contract. Consumer count may be zero, one, or many. Likewise, cross-feature work, dependencies, schemas, endpoints, shared implementation, broad services or repositories, communication channels, and reference-only topology remain ordinary mentions or typed edges unless provider-owned design intent records a stable guarantee.

A state-machine initial-state promise or accepted-event transition promise, and a deliberate REST or CRUD operation with defined behavior under stated conditions, can remain contractual without a useful workflow. Workflow authoring is a discovery and anchoring surface, not a validity requirement. Reconcile only workflow steps evidenced as authoring or enforcing the agreement; keep flow and `FULFILLED_BY` links separate from `DEPENDS_ON` Contract links.

## Editing Contracts

Edit when the provider-owned agreement, promised conditions or behavior, owning or enforcing anchor, visible boundary, or authoritative source changes. Do not create, delete, or semantically rewrite the Contract solely because consumers were added or removed.

## Discipline

Keep the Contract as a pointer and notice; code, payload shape, and runtime behavior remain authoritative elsewhere. Do not move exact schemas, API bodies, or implementation truth into the Contract, and keep ordinary relationships as inline mentions and typed edges.
$contract_edit$
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT';
