-- Register the canonical system-owned Mockup definition only when the
-- lowercase registry key is not already present in either registry source.
-- The staging project-custom row is intentionally left authoritative when the
-- staging rekey transaction has run first.
INSERT INTO work_item_type_template (
  id,
  type_key,
  name,
  role,
  icon_key,
  description,
  section_definitions,
  allowed_parent_types,
  edge_targets,
  allowed_statuses,
  required_scalars,
  forbidden_scalars,
  parentage,
  tracking,
  agent_settable_statuses,
  anchorable_report_types,
  writing_standards,
  agent_guidance,
  accepted_config_kinds,
  capabilities,
  graph_configuration,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  'mockup',
  'Mockup',
  'project-info',
  'task',
  'Houses reviewable static interface previews for new interfaces and interface changes. Mockup items belong beneath the feature or implementation task they illustrate and use a self-contained HTML/CSS mockup with a declared presentation size. The renderer provides the isolated static boundary and host-owned sketch styling; authored content does not define interactions, execute scripts, load external resources, or style outside the isolated document.',
  '[{"key":"purpose","kind":"markdown","label":"Purpose","writingStandard":"Explain the user problem, audience, intended outcome, and design decisions this preview makes concrete. Identify the interface and its scope clearly, and keep the purpose distinct from the HTML/CSS implementation."},{"key":"mockup","kind":"html/css","label":"Mockup","sizeProfiles":[{"key":"desktop","label":"Desktop","breakpoints":[{"page":{"width":1440,"height":900},"inline":{"width":1440,"height":900},"minContainerWidth":0}]},{"key":"tablet","label":"Tablet","breakpoints":[{"page":{"width":768,"height":1024},"inline":{"width":768,"height":1024},"minContainerWidth":0}]},{"key":"mobile","label":"Mobile","breakpoints":[{"page":{"width":390,"height":844},"inline":{"width":390,"height":844},"minContainerWidth":0}]}],"defaultSizeKey":"desktop","writingStandard":"Provide the interface as self-contained static HTML and CSS. Select the configured presentation size that best matches the intended canvas. Use semantic, accessible structure and make responsive behavior visible where it matters. Do not embed JavaScript, external resources, or styles that escape the isolated document; host-owned sketch styling and isolation remain in force."},{"key":"requirements","kind":"markdown","label":"Requirements","writingStandard":"Identify the interface requirements demonstrated by the preview and cite their authoritative feature, task, design document, or Contract with inline entity mentions. Explain how the mockup demonstrates those requirements without creating a competing specification. Clearly label proposed new requirements and reconcile them on their owning entities through proposals."}]'::jsonb,
  '["FEATURE","STANDARD"]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":["FEATURE","STANDARD","mockup"]}]'::jsonb,
  '["BACKLOG","ACTIVE","READY","ARCHIVED"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '{"allowedParentEntityTypes":["TASK"]}'::jsonb,
  '{"allowedSourceTaskTypes":[],"allowedSourceEntityTypes":[]}'::jsonb,
  '["BACKLOG","ACTIVE"]'::jsonb,
  '[]'::jsonb,
  '{"edit":"Keep the three sections, their order, and their distinct responsibilities aligned when revising a Mockup item. Preserve authoritative requirement citations and update the owning source through a proposal when a requirement changes. Keep HTML/CSS self-contained and within the isolated renderer, and keep the selected size profile aligned with the intended presentation canvas. Material revisions to an accepted preview require renewed user acceptance before Ready; archive only at the user''s direction. Do not add child work or use the item as a collected-work container.","create":"New Mockup items must be attached to the feature or implementation task they illustrate and must contain exactly Purpose, Mockup, and Requirements in that order. Purpose should establish the interface problem and intended outcome; Mockup should use the isolated static HTML/CSS section and an appropriate configured size profile; Requirements should cite authoritative sources rather than duplicate them. This is a presentation artifact, not a work collection, and it must not introduce executable behavior, external resource loading, or style escape. Backlog is the initial state; Active means drafting; Ready means the user has reviewed and accepted the preview. The assistant may move drafts between Backlog and Active but must not declare user acceptance."}'::jsonb,
  NULL,
  '[]'::jsonb,
  '{"requiresParent":true,"planEligible":false,"hasSetInitialStatus":true,"rendersInline":true,"showsInExplorerSidebar":false}'::jsonb,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM work_item_type_template
  WHERE type_key = 'mockup'
)
AND NOT EXISTS (
  SELECT 1
  FROM work_item_type
  WHERE type_key = 'mockup'
);
