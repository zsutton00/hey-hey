-- Register the canonical system-owned EVAL and EVAL_CASE definitions. An Eval
-- lives beneath the Feature it evaluates; an Eval Case lives beneath its Eval.
-- Approval of a proposal is what makes a case runnable, so neither type carries
-- a candidate-status model. Each insert is skipped when the key already exists
-- in either registry source, so a project-owned row is never adopted, updated
-- or retyped here.
INSERT INTO work_item_type_template (
  id, type_key, name, role, icon_key, description, section_definitions,
  allowed_parent_types, edge_targets, allowed_statuses, required_scalars,
  forbidden_scalars, parentage, tracking, agent_settable_statuses,
  anchorable_report_types, writing_standards, agent_guidance,
  accepted_config_kinds, capabilities, graph_configuration,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'EVAL',
  'Eval',
  'work-item',
  NULL,
  'An evaluation of one Feature''s behavior. It states what is being evaluated and how results are judged, and holds the reviewed Eval Cases that define the situations to run.',
  '[{"key":"objective","kind":"markdown","label":"Objective","writingStandard":"State the Feature behavior this Eval evaluates and what a good outcome means for the people who rely on it. Cite the Feature and any governing requirements, Contracts or design docs with inline entity mentions."},{"key":"assessmentApproach","kind":"markdown","label":"Assessment approach","writingStandard":"Explain how results across this Eval''s cases are judged: which behaviors matter most, how concrete checks and the qualitative rubric combine, and what counts as a regression. Do not restate individual cases."}]'::jsonb,
  '["FEATURE"]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DEPENDS_ON","targetTypeKeys":[]},{"edgeType":"DERIVES_FROM","targetTypeKeys":[]},{"edgeType":"SUPERSEDES","targetTypeKeys":["EVAL"]},{"edgeType":"EVOLVES","targetTypeKeys":["EVAL"]}]'::jsonb,
  '["ACTIVE","BACKLOG","ON_HOLD","COMPLETED","CANCELLED","ARCHIVED","SUPERSEDED"]'::jsonb,
  '[]'::jsonb,
  '["dueDate"]'::jsonb,
  '{"allowedParentEntityTypes":["TASK"]}'::jsonb,
  '{"allowedSourceTaskTypes":[],"allowedSourceEntityTypes":[]}'::jsonb,
  '["ACTIVE","BACKLOG"]'::jsonb,
  '[]'::jsonb,
  '{"create":"Create an Eval beneath the Feature whose behavior it evaluates. Write the objective and the assessment approach; add the situations to run as Eval Cases beneath it rather than describing them here.","edit":"Keep the objective and assessment approach consistent with the Eval Cases beneath this Eval. Change cases through their own proposals, not by editing this Eval."}'::jsonb,
  '{"overview":"An Eval evaluates one Feature''s behavior. Its Eval Cases, created and changed through ordinary proposal review, are the situations it runs; only approved cases are runnable.","examples":[],"contexts":[{"focalTypeKeys":["FEATURE"],"guidance":"Create an Eval beneath the Feature whose behavior it evaluates."}]}'::jsonb,
  '[]'::jsonb,
  '{"requiresParent":true,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false,"showsInExplorerSidebar":true}'::jsonb,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'EVAL')
  AND NOT EXISTS (SELECT 1 FROM work_item_type WHERE type_key = 'EVAL');

INSERT INTO work_item_type_template (
  id, type_key, name, role, icon_key, description, section_definitions,
  allowed_parent_types, edge_targets, allowed_statuses, required_scalars,
  forbidden_scalars, parentage, tracking, agent_settable_statuses,
  anchorable_report_types, writing_standards, agent_guidance,
  accepted_config_kinds, capabilities, graph_configuration,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'EVAL_CASE',
  'Eval Case',
  'project-info',
  NULL,
  'One reviewed situation an Eval runs: a realistic scenario, the single request that starts it, the real items it involves, the handler it targets, and what must and must not happen. An approved Eval Case is runnable.',
  '[{"key":"situation","kind":"markdown","label":"Situation","writingStandard":"Describe the realistic situation the case starts from, in terms of what the user is trying to accomplish and what state the project is in."},{"key":"request","kind":"markdown","label":"Initiating request","writingStandard":"Give the one user request that starts the case, worded as the user would write it."},{"key":"items","kind":"markdown","label":"Items","writingStandard":"Reference the real focal item and any supporting items the case involves with inline entity mentions, and say what role each plays."},{"key":"handler","kind":"markdown","label":"Target handler","writingStandard":"Name the handler the request is run through."},{"key":"expectations","kind":"markdown","label":"Expected and forbidden behavior","writingStandard":"State the observable behavior that must happen and the behavior that must not, as outcomes a reviewer can confirm from the retained evidence."},{"key":"checks","kind":"markdown","label":"Concrete checks","writingStandard":"List the concrete, objectively verifiable checks that decide whether the expectations were met."},{"key":"rubric","kind":"markdown","label":"Rubric","writingStandard":"Give the qualitative criteria a judge applies to the parts of the outcome that concrete checks cannot decide."},{"key":"evidence","kind":"markdown","label":"Supporting evidence","writingStandard":"Cite the sessions, reports or other records that show why this case matters or what it was derived from, with inline entity mentions."}]'::jsonb,
  '["EVAL"]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DERIVES_FROM","targetTypeKeys":[]},{"edgeType":"SUPERSEDES","targetTypeKeys":["EVAL_CASE"]},{"edgeType":"EVOLVES","targetTypeKeys":["EVAL_CASE"]}]'::jsonb,
  '["ACTIVE","ARCHIVED","SUPERSEDED"]'::jsonb,
  '[]'::jsonb,
  '["dueDate","tag"]'::jsonb,
  '{"allowedParentEntityTypes":["TASK"]}'::jsonb,
  '{"allowedSourceTaskTypes":[],"allowedSourceEntityTypes":[]}'::jsonb,
  '["ACTIVE","ARCHIVED"]'::jsonb,
  '[]'::jsonb,
  '{"create":"Create an Eval Case beneath the Eval it belongs to, through a proposal. Fill every section; a case becomes runnable only when its proposal is approved, so write it to be reviewed as the definitive statement of the situation.","edit":"Change a case through a proposal so the change is reviewed before it is run. Keep the situation, request, expectations and checks consistent with each other."}'::jsonb,
  '{"overview":"An Eval Case is one reviewed situation run by its Eval. It records the scenario, the initiating request, the real items involved, the target handler, expected and forbidden behavior, concrete checks and a rubric. It does not own run attempts, sessions, scores or reports.","examples":[],"contexts":[{"focalTypeKeys":["EVAL"],"guidance":"Create Eval Cases beneath the Eval they belong to."}]}'::jsonb,
  '[]'::jsonb,
  '{"requiresParent":true,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false,"showsInExplorerSidebar":true}'::jsonb,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'EVAL_CASE')
  AND NOT EXISTS (SELECT 1 FROM work_item_type WHERE type_key = 'EVAL_CASE');
