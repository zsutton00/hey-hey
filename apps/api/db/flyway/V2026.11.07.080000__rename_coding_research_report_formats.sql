-- Name CODING_RESEARCH report formats by whether Project Assistant researched
-- alone (SELF_RESEARCH) or was the parent of research subagents (SUBAGENT_PARENT).
UPDATE reports
SET payload = jsonb_set(payload::jsonb, '{format}', '"SELF_RESEARCH"')
WHERE report_type = 'CODING_RESEARCH'
  AND payload ->> 'format' = 'STRUCTURED';

UPDATE reports
SET payload = jsonb_set(payload::jsonb, '{format}', '"SUBAGENT_PARENT"')
WHERE report_type = 'CODING_RESEARCH'
  AND payload ->> 'format' = 'WRITTEN';
