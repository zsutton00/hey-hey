-- Replace overlapping canonical STANDARD writing rules without changing
-- project-owned overrides, other types, or the shared guidance-proof path.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "work_item_type_template" WHERE "type_key" = 'STANDARD'
  ) THEN
    RAISE EXCEPTION 'Cannot refocus task guidance; canonical STANDARD template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT $writing$**What a task is**

Write a task the user can review and an agent can carry out. A feature describes a capability; a task describes a concrete change that delivers it. Make the outcome, affected parts of the system, and consequential choices clear enough to approve.

**Ground the scope**

Base the task on the user’s request, their decisions and corrections, and applicable reviewed project requirements. Necessary implementation work belongs in scope; additional product behavior requires agreement. Engineering standards constrain implementation without authorizing additional outcomes. Apply this rule throughout the description, implementation, and acceptance criteria.

**Verify where the change belongs**

Establish which part of the system owns the behavior before choosing the parent and Services. When ownership or an implementation point is unclear, search the relevant project context. Do not assign work to the surface displaying a problem merely because that is where it was noticed. Include the complete known Service scope without guessing.

**Description**

Explain what changes and why in plain language. Reference applicable project knowledge rather than restating it. Keep file-level details in the implementation field.

**Implementation**

Identify the relevant Services, components, APIs, or files and explain what changes in each. Include established patterns, constraints, and consequential changes to responsibilities or interactions. Naming files alone is insufficient; an exhaustive symbol inventory is unnecessary.

Describe technical shapes or algorithms only when they are needed to understand a consequential choice or preserve an established decision. Multiple possible implementations do not by themselves require choosing one during task authoring. Leave routine engineering choices to the implementer.

When the change affects a boundary governed by a Contract, cite the applicable agreement and explain how the change honors it. Surface conflicts or missing durable agreements separately; topical overlap alone does not establish a Contract.

Resolve questions that materially change the outcome, scope, or architectural responsibility before submitting. A task need not settle every implementation detail to be ready.

**Acceptance criteria**

List concrete, verifiable results derived from the agreed scope. Include meaningful boundaries where needed. Remove redundant criteria rather than combining distinct results into dense bullets to meet a count.

**Preserve decisions and readability**

Preserve established decisions, constraints, and necessary rationale so another agent can continue without the conversation. Do not reopen settled choices or reconstruct unrelated history. Use direct language and enough detail to make the work reviewable; remove repetition and speculative detail.$writing$ AS writing,
    $relationships$## Structured relationships

Declare typed cross-entity relationships in the proposal's structured `edges` parameter. Prose mentions provide navigation but do not materialize graph edges. Declare `SUPERSEDES` on the successor proposal, targeting the predecessor; approval performs the atomic transition. Do not create raw `SUPERSEDES` edges or directly set `SUPERSEDED`.$relationships$ AS relationships,
    $scope$## Complete known service scope

For a work-item type whose registry role is `work-item`, include `serviceIds` whenever implementation scope is known. The supplied IDs are the complete set: include every service explicitly mentioned in the description or implementation detail, without guessing additional services. On create, omit `serviceIds` only when scope is genuinely unknown. On edit, omit it to preserve current assignments; supply an empty array only to assert that the complete known set is empty.$scope$ AS scope,
    $create_field$## The implementation field

`create_work_item` accepts a dedicated `implementation` parameter separate from the section list. The tool folds it into a trailing `## Implementation` block on the description. Do not hand-write that heading or duplicate the detail in the description prose.$create_field$ AS create_field,
    $edit_field$## The implementation field

`edit_work_item` accepts a dedicated `implementation` parameter separate from the section list. The tool folds it into a trailing `## Implementation` block on the description and preserves the existing description when no replacement description section is supplied. Do not hand-write that heading or duplicate the detail in the description prose.$edit_field$ AS edit_field
)
UPDATE "work_item_type_template" AS template
SET "writing_standards" = jsonb_build_object(
      'create', concat_ws(E'\n\n', guidance.writing, guidance.create_field, guidance.relationships, guidance.scope),
      'edit', concat_ws(E'\n\n', guidance.writing, guidance.edit_field, guidance.relationships, guidance.scope)
    ),
    "updated_at" = CURRENT_TIMESTAMP
FROM guidance
WHERE template."type_key" = 'STANDARD';
