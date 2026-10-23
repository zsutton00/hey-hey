-- Keep per-type Contract authoring guidance aligned with the ambient
-- Contract-recognition gate without making the type definition its owner.

UPDATE "work_item_type"
SET "writing_standards" = jsonb_build_object(
      'create',
      '## Before drafting

Draft a Contract only when the current work exposes or changes one specific durable agreement across a feature boundary and identifies one concrete owner or enforcement anchor. Merely summarizing existing owners, mentioning a typed schema, or adding cross-feature references does not qualify; preserve those as inline mentions and ordinary typed edges.

A whole service, repository, specification family, or general communication channel is not an anchor. Prefer the responsible workflow step; otherwise use the narrowest operation, work item, design artifact, or schema that owns or enforces the agreement.

Positive example: two owners share named AuditRecord invariants, require joint acknowledgement of changes, and identify the governing design doc. Negative example: a roll-up feature mentions the same schema only to point readers at its existing owners.

## What a contract is

A Contract records that a user-authored agreement exists across a feature boundary. It is a pointer and notice, not the source of truth for code, payload shape, or runtime behavior.

## Section shape

Contracts are single-section: `description` states the agreement in the user''s terms and names the boundary it makes visible. Parent the Contract to the feature that owns one side of the agreement; use graph edges to connect the other side.

## Discipline

Do not encode payload schemas, exact API bodies, or implementation truth in the Contract. Keep children, tags, and due dates off the item.',
      'edit',
      '## Before editing

Keep a Contract only when the current work exposes or changes one specific durable agreement and a narrow authoritative anchor still owns or enforces it. References to an existing owner, typed schema, service, repository, specification family, or communication channel do not establish a Contract by themselves.

## Editing contracts

Edit when the agreement summary, owning feature side, or visible boundary changes. Preserve the pointer model: the code remains the source of truth, and graph edges carry the relationship to the other side.

## Common edit failure modes

- **Payload source of truth.** Move exact payload shape or code-level rules to the implementation contract that owns them.
- **Loose relationship only.** Use inline mentions and ordinary typed edges when the work only summarizes or references existing owners.'
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT'
  AND "is_system" = true
  AND "lifecycle_status" = 'active';
