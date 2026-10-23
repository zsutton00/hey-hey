-- Constrain canonical Contract prose to one provider-owned observable promise,
-- then reconcile authority and participation through topology separately.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'CONTRACT'
  ) THEN
    RAISE EXCEPTION
      'Cannot constrain Contract guidance; canonical Contract template is missing';
  END IF;
END
$migration$;

UPDATE "work_item_type_template"
SET "description" = $contract_description$
A Contract records one durable promise made by an identified provider at an owned interaction point: when stated conditions are met, the provider guarantees a stated, observable delivery. Every part of the promise must be within the provider’s control or enforced by its owned boundary.

The Contract records only that promise. It does not describe consumer UX, workflow context, downstream use, implementation, exact payload shape, or behavior merely expected from a third party. It points to the authoritative source without replacing it.
$contract_description$,
    "writing_standards" = jsonb_build_object(
      'create',
      $contract_create$
## Before drafting

Identify:

1. The provider making the promise.
2. The provider-owned interaction point that enforces it.
3. The conditions accepted at that interaction point.
4. The observable delivery guaranteed when those conditions are met.
5. The authoritative source for the promise.

Draft only when the provider intentionally offers a durable guarantee and no
existing Contract covers it.

Do not draft a Contract from a dependency, shared schema, endpoint, workflow
handoff, cross-feature change, or third-party expectation alone.

## Writing the description

Write the promise in this form:

> When <conditions>, <provider> guarantees <observable delivery>.

Add another sentence only when it defines semantics required to determine
whether that same delivery was fulfilled or breached, such as timing,
acknowledgement, preservation, idempotency, or owned failure classification.

Every sentence must answer at least one of these questions:

- What conditions does the provider accept?
- What does the provider guarantee?
- How can fulfillment or breach be observed?

Remove anything that instead explains:

- how a user reaches the interaction;
- why or where a consumer uses the result;
- preceding or downstream workflow steps;
- UI behavior;
- feature participation;
- implementation mechanics;
- behavior expected from a third party but not enforced by the provider.

When an external system participates, state only the behavior the identified
provider controls. For example, promise the owned adapter’s classification,
normalization, acknowledgement, or returned result—not what the external
system itself will do.

State semantic payload guarantees when they are part of the promise, but cite
the authoritative schema or operation for exact shape and implementation
truth.

## Authority and topology

Keep authority and participation separate from the promise body. Use the
narrowest available typed relationship for the authoritative source. Use the
structural parent, feature edges, and workflow-step dependencies for topology;
do not narrate those relationships in the Contract description.

## Reconcile topology after writing

After the provider-owned promise is complete, record topology separately:

- The structural parent is the owning feature; do not duplicate it with
  `RELATED_TO`.
- Use Contract `RELATED_TO` only for other features directly providing,
  consuming, or enforcing the promise.
- Use `workflow_step DEPENDS_ON Contract` only for steps that author or enforce
  the promise.
- Do not link ancestors, incidental implementation features, or downstream
  consumers merely because they use the result.
- Do not add any of this participation narrative to the Contract description.
$contract_create$,
      'edit',
      $contract_edit$
## Editing a Contract

Preserve one provider-owned promise. Edit the Contract only when its provider,
owned interaction point, accepted conditions, observable delivery, or
authoritative source changes.

Apply the sentence test again: every sentence must distinguish fulfillment
from breach of the provider’s promise. Remove UX, consumer purpose, workflow
sequence, downstream use, implementation detail, and unowned third-party
behavior.

If a clause cannot be enforced by the named provider, either restate it as
behavior enforced by the provider’s owned boundary or remove it from the
Contract.

Consumer and workflow participation changes normally update topology, not the
Contract body. Adding or removing consumers does not itself create, invalidate,
or semantically change the promise.

## Reconcile topology after writing

After the provider-owned promise is complete, record topology separately:

- The structural parent is the owning feature; do not duplicate it with
  `RELATED_TO`.
- Use Contract `RELATED_TO` only for other features directly providing,
  consuming, or enforcing the promise.
- Use `workflow_step DEPENDS_ON Contract` only for steps that author or enforce
  the promise.
- Do not link ancestors, incidental implementation features, or downstream
  consumers merely because they use the result.
- Do not add any of this participation narrative to the Contract description.
$contract_edit$
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT';
