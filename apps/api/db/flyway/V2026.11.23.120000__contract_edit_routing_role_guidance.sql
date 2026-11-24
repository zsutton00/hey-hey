-- Moves "Contract edits are separate proposals" out of the shared platform prompt and into
-- Contract session-role guidance. Research states findings; sync and implementation carry the rule.
-- Canonical templates and project copies are extended only while the role still holds the exact
-- canonical wording, so project-authored guidance is untouched. Idempotent.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'CONTRACT') THEN
    RAISE EXCEPTION 'Cannot move Contract edit routing into role guidance; canonical Contract template is missing';
  END IF;
END
$migration$;

CREATE FUNCTION pg_temp.extend_role(guidance jsonb, role text, canonical text, addition text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN guidance->>role = canonical THEN jsonb_set(guidance, ARRAY[role], to_jsonb(canonical || ' ' || addition))
    ELSE guidance
  END
$fn$;

CREATE FUNCTION pg_temp.extend_contract(guidance jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT pg_temp.extend_role(
    pg_temp.extend_role(
      pg_temp.extend_role(
        guidance,
        'research',
        'Read the Contract and identify its provider, owned boundary, accepted conditions and guaranteed result. Determine whether the behavior being investigated falls within that promise. Gather evidence of fulfillment or breach, distinguishing observation from inference. Do not infer a new promise from implementation. Raise an observed breach as high priority.',
        'Report an affected Contract as a finding: the Contract, what it governs and why it is affected. A research handoff does not say who must edit it or how.'),
      'sync',
      'Check the delivered or planned work against the promise this Contract makes at its boundary. Treat any violation as high priority and raise it to the user. Offer a Contract update only where the user has chosen to change the promise.',
      'Propose a Contract content edit as a separate proposal that mentions the Contract, and surface any changed guarantee for the user to decide instead of transferring a promise yourself.'),
    'implementation',
    'Read applicable Contracts before changing the affected behavior. Fulfill or preserve their guarantees for conforming consumers. Add or update tests that exercise the affected promise at its owned boundary, using integration tests where needed. If the implementation cannot honor the promise, raise the conflict before proceeding with that departure. If discovered after editing, reconcile the implementation and tests before declaring completion. Raise an observed breach as high priority; do not silently weaken the promise to fit the code.',
    'Propose a Contract content edit as a separate proposal that mentions the Contract, and surface any changed guarantee for the user to decide instead of transferring a promise yourself.')
$fn$;

UPDATE work_item_type_template
SET session_role_guidance = pg_temp.extend_contract(session_role_guidance),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'CONTRACT'
  AND session_role_guidance IS NOT NULL
  AND session_role_guidance IS DISTINCT FROM pg_temp.extend_contract(session_role_guidance);

UPDATE work_item_type
SET session_role_guidance = pg_temp.extend_contract(session_role_guidance),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'CONTRACT'
  AND project_id IS NOT NULL
  AND session_role_guidance IS NOT NULL
  AND session_role_guidance IS DISTINCT FROM pg_temp.extend_contract(session_role_guidance);
