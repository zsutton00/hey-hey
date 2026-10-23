-- Clarify that a Decision records adopted direction rather than proof of current
-- implementation, and add Decision maintenance advice. Complete project
-- overrides remain authoritative and keep their existing guidance.
UPDATE work_item_type_template
SET description = description || ' A Decision records an adopted choice and intended direction, not proof of the project''s current implementation.',
agent_guidance = jsonb_set(
  agent_guidance,
  '{overview}',
  to_jsonb((agent_guidance ->> 'overview') || ' A Decision states the direction the project adopted, which may still need implementation. Being unimplemented does not make it invalid; distinguish the authoritative choice from evidence that it has been fulfilled.')
),
maintenance_guidance = $decision$A Decision records an adopted choice and intended direction. It stays authoritative even when the project does not yet implement it; implementation is evidence of fulfillment, never proof of the choice. When work connected to a Decision changes, check that it is consistent with the choice, and keep affected Features and the Tasks implementing the choice connected to the Decision through accurate typed relationships (add missing links, correct or remove inaccurate ones; Features and Tasks hold these links on their own edges). When the choice itself changes, review the connected work and surface each discrepancy to the user without claiming it is already reconciled. If work or code diverges from the Decision, report the gap; do not rewrite the Decision to match drift. A change of direction goes through a successor Decision.$decision$,
updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'decision';
