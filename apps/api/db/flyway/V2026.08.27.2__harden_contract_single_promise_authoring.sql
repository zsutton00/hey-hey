-- Persist the iterated canonical Contract definition and writing standards.
-- This supersedes the prior canonical prose without changing project-owned
-- overrides or any non-prose template configuration.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'CONTRACT'
  ) THEN
    RAISE EXCEPTION
      'Cannot harden Contract single-promise authoring; canonical Contract template is missing';
  END IF;
END
$migration$;

UPDATE "work_item_type_template"
SET "description" = $contract_description$
A Contract records one deliberately designed, durable promise made by an identified provider at an owned interaction point. It states the concrete input or triggering conditions accepted at that boundary and the provider-controlled, observable delivery guaranteed when those conditions are met. The delivery may be a returned result, acknowledgement, state transition, workflow continuation, event, side effect, rejection, preservation rule, or timing or availability guarantee. Every part of the promise must be controlled by the provider or enforced at its owned boundary.

A Contract owns one promise. A shared transport, feature, workflow, or implementation path may contain several candidate boundaries, but it does not justify combining admission, dispatch, publication, replay, consumer synchronization, and downstream use into one umbrella Contract.

A Contract cannot be inferred from implementation alone. Code, schemas, endpoints, workflows, tests, and current consumer behavior may reveal a candidate or demonstrate fulfillment or breach, but they do not establish the deliberate design intent that creates the Contract.

The Contract records only the durable promise. It lets participants treat the provider’s implementation as a black box, points to the authoritative source for exact representation, and excludes consumer UX, workflow context, downstream use, internal mechanics, exact payload reconstruction, maintenance plans, and behavior merely expected from another provider.
$contract_description$,
    "writing_standards" = jsonb_set(
      jsonb_set(
        COALESCE("writing_standards", '{}'::jsonb),
        '{create}',
        to_jsonb($contract_create$
## Proposal authorization is not design completeness

## Mandatory umbrella hard stop

This is a hard stop, not a drafting preference. Stop before creating a proposal
and ask the user to select the intended promise when any of the following is
true:

- The requested scope contains more than one plausible provider.
- The scope contains more than one owned interaction point.
- The scope contains more than one independently observable delivery.
- The request names a feature, system, channel, transport, workflow, or product
  area that contains several candidate promises.
- Producing one Contract would require choosing the "strongest", "best",
  "primary", "most likely", or most implemented candidate on the user's behalf.
- Narrowing the request would materially change the provider, trigger,
  consequence, or boundary stated by the user.
- An existing Contract substantially matches the candidate's provider,
  interaction point, accepted conditions, or guaranteed delivery.

Do not resolve an umbrella request by silently selecting one candidate, even
when the graph or implementation makes one candidate appear stronger than the
others. Explicit authorization to write a Contract does not authorize the agent
to choose which of several promises the user intends.

Before asking, present a bounded set of distinct candidates. For each candidate,
identify only:

1. The provider.
2. The owned interaction point.
3. The high-level observable delivery.
4. Any existing Contract that may already own or overlap the promise.

When an existing Contract substantially overlaps the candidate, do not create a
duplicate. Ask whether the user intends to rely on the existing Contract,
deliberately edit or evolve it, replace it, or author a genuinely distinct
boundary.

Proceed without another question only when the user has already selected one
specific promise, or when deliberate graph context resolves exactly one
provider-owned boundary, no material reinterpretation is required, and no
existing Contract owns substantially the same promise.

A Contract proposal requires user participation. Draft only when the user
explicitly requests Contract authoring, or after the agent presents a specific
candidate for discussion and the user affirmatively confirms that it should be
authored.

That authorization permits authoring; it does not supply missing design
semantics. A broad request such as "write a Contract for this feature" usually
identifies an area, not one complete promise. When the area contains multiple
candidate boundaries, present the narrow candidates and ask which durable
promise the user intends. Do not convert the entire feature, transport, workflow,
or implementation into an umbrella Contract.

Do not submit a Contract proposal in the same step as unsolicited discovery.
An authoritative design or existing implementation may support a suggestion,
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

Recorded product or design decisions may resolve details the user omitted when
they clearly govern the same boundary. They do not authorize silently changing
the user's stated provider, trigger, or consequence. If grounding requires a
material reinterpretation of the request, state the interpretation and resolve
the mismatch before proposing.

## One-promise boundary test

Before drafting, state the single promise in one sentence:

> At <owned interaction point>, when <accepted conditions>, <provider>
> guarantees <provider-controlled observable delivery>.

Then test every additional clause:

- Keep it only if the same provider controls or enforces it at the same boundary.
- Keep it only if it is necessary to distinguish fulfillment, breach, or
  compatibility of this promise.
- Exclude upstream authentication, authorization, validation, or routing unless
  it is an accepted condition at this exact boundary rather than a promise owned
  elsewhere.
- Exclude downstream replay, hydration, cache synchronization, presentation, and
  consumer handling unless this provider deliberately guarantees them at this
  exact boundary.
- Split admission, dispatch, publication, persistence, replay, and consumption
  when they are separate provider-owned promises.
- Do not absorb an adjacent Contract's promise. Cite it as a dependency or
  participating boundary instead.

If the description naturally needs several interaction points or several
providers to remain coherent, it is more than one Contract.

## Before drafting

Confirm:

1. The single provider and its owned interaction point.
2. The concrete input or triggering conditions accepted there.
3. The one provider-controlled observable delivery.
4. How fulfillment or breach is observed.
5. The authoritative source for exact representation.
6. The intended stability and evolution posture.
7. That no existing Contract already owns the same promise.
8. Which adjacent guarantees are dependencies rather than clauses of this
   Contract.
9. That any normalization of the user's wording is non-material or explicitly
   acknowledged.

If these remain unresolved after consulting the relevant graph and deliberate
design sources, discuss the design with the user and abstain from proposing.
Do not fill gaps from implementation convention, consumer count, or likely
future needs.

## Required two-paragraph description

Every Contract description must contain exactly two prose paragraphs. Do not
add headings, bullets, numbered lists, or additional paragraphs.

The first paragraph must be exactly one high-level sentence beginning with
"Guarantees". It summarizes the single durable outcome without naming payload
fields, validation steps, transport mechanics, authoritative sources, topology,
consumer behavior, or implementation details.

The second paragraph states the complete boundary promise: the provider and its
owned interaction point, the accepted input or triggering conditions, and the
provider-controlled observable delivery. Include only additional rejection,
preservation, ordering, timing, compatibility, or evolution semantics needed to
distinguish fulfillment from breach. Place authoritative-source references in
this paragraph. Keep adjacent providers and separately owned promises out of
both paragraphs.

## Writing the description

Write the promise in this form:

> At <interaction point>, when <input or triggering conditions>, <provider>
> guarantees <provider-controlled observable delivery>.

The guaranteed delivery need not be a response payload. It may be an
acknowledgement, state transition, workflow continuation, event, side effect,
rejection, preservation rule, or timing or availability guarantee.

Add another sentence only when it defines semantics required to determine
fulfillment, breach, or compatibility, such as acknowledgement, timing,
preservation, ordering, idempotency, rejection, failure classification,
versioning, or transition guarantees.

Do not add validation inventories, internal processing stages, consumer
behavior, or neighboring promises merely because they appear in the same
authoritative design.

## Black-box boundary and evolution

The Contract must let participants depend on the agreement without depending
on one another's internal implementation. Remove consumer UX, workflow
narrative, downstream use, internal mechanics, current consumer-specific
envelopes, and behavior expected from a third party but not enforced by the
provider.

State semantic guarantees when necessary, but point to the authoritative
operation, schema, Contract, or design source for exact representation and
adjacent promises. Record only observable compatibility or evolution guarantees
in the Contract body. Keep implementation and migration plans elsewhere.

## Reconcile topology after writing

After the promise is complete, record topology separately:

- The structural parent is the owning feature; do not duplicate it with
  `RELATED_TO`.
- Use Contract `RELATED_TO` only for other features directly providing,
  consuming, or enforcing the promise.
- Use Contract `DEPENDS_ON` when this promise relies on a separately owned
  Contract that must remain valid.
- Use `workflow_step DEPENDS_ON Contract` only for steps that author or enforce
  the promise.
- Do not link ancestors, incidental implementation features, or downstream
  participants merely because they use the result.
- Do not add participation narrative to the Contract description.
$contract_create$::text),
        true
      ),
      '{edit}',
      to_jsonb($contract_edit$
## Proposal authorization

Material Contract edits require the same user participation as creation. Edit
the promise only when the user requests the change, or after presenting the
change for discussion and receiving affirmative confirmation.

Authorization to edit does not authorize filling unresolved semantics from
implementation or broadening one Contract to cover an entire feature or
integration path.

## Required two-paragraph description

After every material edit, the complete Contract description must contain
exactly two prose paragraphs. Do not retain or introduce headings, bullets,
numbered lists, or additional paragraphs.

The first paragraph must remain exactly one high-level sentence beginning with
"Guarantees". It summarizes the single durable outcome without naming payload
fields, validation steps, transport mechanics, authoritative sources, topology,
consumer behavior, or implementation details.

The second paragraph contains the complete boundary promise: the provider and
its owned interaction point, the accepted input or triggering conditions, and
the provider-controlled observable delivery. Retain only additional rejection,
preservation, ordering, timing, compatibility, or evolution semantics needed to
distinguish fulfillment from breach. Place authoritative-source references in
this paragraph. Remove adjacent providers and separately owned promises rather
than creating a third paragraph.

## Editing one promise

Edit only when the deliberately designed agreement changes: its provider, owned
interaction point, accepted conditions, one guaranteed delivery, observability,
authoritative source, or compatibility semantics.

Preserve the one-promise boundary. If an edit introduces another provider,
interaction point, or independently observable delivery, determine whether it
belongs in a separate Contract. Do not merge upstream admission, transport,
publication, persistence, replay, synchronization, and consumer behavior merely
because they participate in one end-to-end flow.

When another Contract owns an adjacent guarantee, retain that ownership and
record a dependency instead of restating or absorbing its promise.

Never rewrite a Contract merely to match implementation drift. When code and
the Contract differ, determine whether the implementation breaches the promise
or the intended integration has deliberately evolved, then discuss that
distinction with the user. Fix the implementation, edit the confirmed promise,
or author a successor as appropriate.

Implementation, consumer, workflow, or call-site changes do not themselves
change the Contract. Update topology separately unless the designed promise has
changed.

If the proposed edit requires materially reinterpreting the user's stated
provider, trigger, or consequence, surface that interpretation before proposing
the edit.

Every retained sentence must help distinguish fulfillment, breach, or
compatibility. Remove validation inventories, consumer-specific behavior,
workflow narrative, implementation inventory, maintenance plans, downstream
replay or synchronization owned elsewhere, and expectations the provider does
not control or enforce. Preserve black-box implementation freedom and point to
authoritative sources for exact representation and adjacent promises.

## Reconcile topology after writing

After the promise is complete, record topology separately:

- The structural parent is the owning feature; do not duplicate it with
  `RELATED_TO`.
- Use Contract `RELATED_TO` only for other features directly providing,
  consuming, or enforcing the promise.
- Use Contract `DEPENDS_ON` when this promise relies on a separately owned
  Contract that must remain valid.
- Use `workflow_step DEPENDS_ON Contract` only for steps that author or enforce
  the promise.
- Do not link ancestors, incidental implementation features, or downstream
  participants merely because they use the result.
- Do not add participation narrative to the Contract description.
$contract_edit$::text),
      true
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT';
