-- Adds only the sync role to canonical advice. Other roles and complete project overrides are untouched.
DO $migration$
DECLARE
  advice jsonb := $advice$
{
  "FEATURE": "Compare each Feature requirement with the delivered evidence, such as behavior, tests and the work that cites it, not with task status. Offer a reviewable update where a requirement or description no longer matches what was delivered or planned.",
  "STANDARD": "Compare the task's scope and acceptance criteria with what was delivered or planned. Offer a task update where the work diverged materially from what the task says.",
  "BUG": "Compare the reported defect and its expected behavior with what was delivered or planned. Offer a bug update where the fix, its scope or the described behavior has drifted.",
  "mockup": "Look for plausible impact: if the delivered or planned work could change what this Mockup shows, offer a reviewable Mockup update. Do not filter by priority, and do not skip the offer because visual agreement cannot be established from code.",
  "DIAGRAM": "Look for plausible impact: if the delivered or planned work could change the participants, relationships or flow this Diagram shows, offer a reviewable Diagram update. Do not filter by priority, and do not skip the offer because structural agreement cannot be proven from code.",
  "DIAGRAM_ELEMENT": "Check whether the delivered or planned work changes what this element represents or the element it references. Offer an update to the element, or to its Diagram, where the change is plausible; do not filter by priority.",
  "CONTRACT": "Check the delivered or planned work against the promise this Contract makes at its boundary. Treat any violation as high priority and raise it to the user. Offer a Contract update only where the user has chosen to change the promise.",
  "decision": "Check whether the delivered or planned work follows or departs from this Decision. Raise a departure to the user rather than silently accepting it, and offer an update only where the choice itself has changed.",
  "EVAL": "Check whether the delivered or planned work changes the Feature behavior this Eval judges. Offer an update where its description or judging criteria no longer match.",
  "EVAL_CASE": "Check whether the delivered or planned work changes the scenario, items or expected outcomes this case runs. Offer an update where the case would no longer reflect real behavior.",
  "PLAN": "Compare the Plan's stages with what was delivered or planned. Offer a Plan update where stage scope, order or dependencies have drifted.",
  "PLAN_STAGE": "Compare this stage's tasks and dependencies with what was delivered or planned. Offer a stage update where its scope or ordering no longer matches.",
  "GOAL": "Check whether the delivered or planned work moves this Goal's outcome or changes the work expected to deliver it. Offer a Goal update where its references or progress picture have drifted.",
  "TASK_MONITOR": "Check whether the delivered or planned work changes the selected work, order or policies this monitor tracks. Offer an update where its selection or dependency shape no longer matches."
}
$advice$::jsonb;
  missing_keys text;
BEGIN
  SELECT string_agg(expected.type_key, ', ' ORDER BY expected.type_key)
    INTO missing_keys
  FROM jsonb_object_keys(advice) AS expected(type_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM work_item_type_template AS template
    WHERE template.type_key = expected.type_key
  );

  IF missing_keys IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot seed sync session-role guidance; canonical templates missing: %', missing_keys;
  END IF;

  UPDATE work_item_type_template AS template
  SET session_role_guidance = jsonb_set(COALESCE(template.session_role_guidance, '{}'::jsonb), '{sync}', entry.value),
      updated_at = CURRENT_TIMESTAMP
  FROM jsonb_each(advice) AS entry(key, value)
  WHERE template.type_key = entry.key;
END
$migration$;
