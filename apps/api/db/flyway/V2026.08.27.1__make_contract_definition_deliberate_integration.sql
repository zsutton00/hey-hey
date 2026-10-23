-- Define Contracts as deliberately designed integrations and require user
-- participation before agent-authored Contract proposals.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'CONTRACT'
  ) THEN
    RAISE EXCEPTION
      'Cannot update deliberate Contract definition; canonical Contract template is missing';
  END IF;
END
$migration$;

UPDATE "work_item_type_template"
SET "description" = $contract_description$
A Contract records a deliberately designed, durable integration agreement between two or more systems. At an identified provider’s owned interaction point, it defines the concrete input or triggering conditions the provider accepts and the provider-controlled behavior guaranteed when those conditions are met. The guaranteed behavior may be any observable consequence, including a returned result, acknowledgement, state transition, workflow continuation, event, side effect, rejection, preservation rule, or timing or availability guarantee. Every part of the promise must be controlled by the provider or enforced at its owned boundary.

A Contract cannot be inferred from implementation alone. Code, schemas, endpoints, workflows, tests, and current consumer behavior may demonstrate fulfillment or breach, but they do not establish the design intent that creates the Contract.

The Contract records only the durable promise. It lets participating systems treat one another’s internal implementation as a black box, points to the authoritative source for exact representation, and excludes consumer UX, workflow narrative, downstream use, implementation mechanics, and maintenance plans.
$contract_description$,
    "writing_standards" = jsonb_build_object(
      'create',
      $contract_create$
## Proposal threshold

A Contract proposal requires user participation. Draft only when the user
explicitly requests Contract authoring, or after the agent presents a Contract
candidate for discussion and the user affirmatively confirms that it should be
authored. Discovery permits suggestion and discussion; it does not authorize
an immediate proposal.

Do not submit a Contract proposal in the same step as an unsolicited discovery.
An authoritative design or existing implementation may support the suggestion,
but neither bypasses the user-confirmation gate.

## Discovery is not proof

Code, schemas, endpoints, tests, workflow handoffs, shared transports, and
current consumer behavior may reveal a possible integration boundary. They
cannot, by themselves, prove that a Contract exists or establish its intended
promise.

Use implementation evidence to find a candidate worth discussing, locate the
likely provider and interaction point, assess whether an existing Contract is
fulfilled or breached, or identify accidental coupling. Never reverse-engineer
the current implementation into a Contract and present it as intentional design.

## Before drafting

Confirm:

1. The participating systems.
2. The provider and its owned interaction point.
3. The concrete input or triggering conditions accepted there.
4. The provider-controlled behavior guaranteed when those conditions are met.
5. How fulfillment or breach is observed.
6. The authoritative source for exact representation.
7. The intended stability and evolution posture.
8. That no existing Contract already owns the same promise.

If any of these are unresolved, discuss the design with the user and abstain
from proposing the Contract. Do not fill gaps from implementation convention,
consumer count, or likely future needs.

## Writing the description

Write the promise in this form:

> At <interaction point>, when <input or triggering conditions>, <provider> guarantees <provider-controlled observable behavior>.

The guaranteed behavior need not be a response payload. It may be an
acknowledgement, state transition, workflow continuation, event, side effect,
rejection, preservation rule, or timing or availability guarantee.

Add another sentence only when it defines semantics required to determine
fulfillment, breach, or compatibility, such as acknowledgement, timing,
preservation, ordering, idempotency, rejection, failure classification,
versioning, or transition guarantees.

## Black-box boundary and evolution

The Contract must let participating systems depend on the agreement without
depending on one another’s internal implementation. Remove consumer UX,
workflow narrative, downstream use, internal mechanics, current
consumer-specific envelopes, and behavior expected from a third party but not
enforced by the provider.

State semantic guarantees when necessary, but point to the authoritative
operation, schema, or design source for exact representation. Consider how the
integration can be maintained or extended without accidental breakage, while
recording only observable compatibility or evolution guarantees in the
Contract body. Keep implementation and migration plans elsewhere.

## Reconcile topology after writing

After the promise is complete, record topology separately:

- The structural parent is the owning feature; do not duplicate it with
  `RELATED_TO`.
- Use Contract `RELATED_TO` only for other features directly providing,
  consuming, or enforcing the promise.
- Use `workflow_step DEPENDS_ON Contract` only for steps that author or enforce
  the promise.
- Do not link ancestors, incidental implementation features, or downstream
  participants merely because they use the result.
- Do not add participation narrative to the Contract description.
$contract_create$,
      'edit',
      $contract_edit$
## Proposal threshold

Material Contract edits require the same user participation as creation. Edit
the promise only when the user requests the change, or after presenting the
change for discussion and receiving affirmative confirmation.

## Editing a Contract

Edit only when the deliberately designed agreement changes: its participating
boundary, provider, owned interaction point, accepted input or triggering
conditions, guaranteed behavior, observability, authoritative source, or
compatibility semantics.

Never rewrite a Contract merely to match implementation drift. When code and
the Contract differ, determine whether the implementation breaches the promise
or the intended integration has deliberately evolved, then discuss that
distinction with the user. Fix the implementation, edit the confirmed promise,
or author a successor as appropriate.

Implementation, consumer, workflow, or call-site changes do not themselves
change the Contract. Update topology separately unless the designed promise
has changed.

Every retained sentence must help distinguish fulfillment, breach, or
compatibility. Remove consumer-specific behavior, workflow narrative,
implementation inventory, maintenance plans, and expectations the provider
does not control or enforce. Preserve black-box implementation freedom and
point to the authoritative source for exact representation.

## Reconcile topology after writing

After the promise is complete, record topology separately:

- The structural parent is the owning feature; do not duplicate it with
  `RELATED_TO`.
- Use Contract `RELATED_TO` only for other features directly providing,
  consuming, or enforcing the promise.
- Use `workflow_step DEPENDS_ON Contract` only for steps that author or enforce
  the promise.
- Do not link ancestors, incidental implementation features, or downstream
  participants merely because they use the result.
- Do not add participation narrative to the Contract description.
$contract_edit$
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT';
