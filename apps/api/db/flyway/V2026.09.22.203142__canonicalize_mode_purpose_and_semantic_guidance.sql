-- Move the settled MODE purpose and semantic guidance from a project override
-- into the canonical template. Complete project overrides remain authoritative.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot canonicalize MODE purpose and semantic guidance; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH canonical AS (
  SELECT
    btrim($mode_purpose$
A reusable set of instructions for how an agent approaches work. Create a mode for a recurring kind of work that benefits from a particular focus, workflow, or output style.
$mode_purpose$::text, E'\n') AS purpose,
    btrim($mode_guidance$
A mode captures a reusable approach an agent can apply across sessions: its focus, working process, collaboration style, and expectations for outputs. It can support implementation, investigation, research, meeting preparation, or other agent work.

Consider a mode when a user repeatedly supplies similar working instructions, a recurring activity benefits from a consistent approach, or a successful session establishes a process worth using again. Repeated subject matter alone is insufficient; identify the reusable approach.

For example, a meeting-preparation mode might guide an agent to gather context, identify decisions needed, and produce a briefing. Preparing Thursday’s briefing is the individual request; the mode supplies the approach.

Keep product requirements, defects, and project-wide standards in their own records. A mode guides the selected session’s behavior; it does not grant additional tools or permissions. Skills remain separately reusable guidance for particular activities.

## MODE placement, eligibility, and freshness

Every MODE has one structural owning Feature. Structural parentage locates the MODE and identifies the capability whose evolution should trigger a freshness review; it does not restrict launch eligibility. RELATED_TO is also navigational and never filters launch.

Only outbound MODE-to-Feature DEPENDS_ON relationships restrict Feature eligibility. Each dependency makes the MODE eligible for the target Feature and its descendants. A MODE with no outbound Feature DEPENDS_ON is project-global. Feature eligibility intersects with the MODE's agentGuidance.contexts[].focalTypeKeys work-item-type compatibility; neither axis replaces the other.

Keep MODE.md and supporting text files current as requirements, decisions, and completed work evolve on either the owning Feature or a Feature covered by outbound DEPENDS_ON applicability. Surface stale content through targeted, user-reviewable MODE proposals. Never mutate MODE content directly, and do not alter immutable bundles already captured by Agent Sessions.
$mode_guidance$::text, E'\n') AS semantic_guidance
)
UPDATE work_item_type_template AS mode
SET description = canonical.purpose,
    agent_guidance = jsonb_set(
      COALESCE(mode.agent_guidance, '{}'::jsonb),
      '{overview}',
      to_jsonb(canonical.semantic_guidance),
      true
    ),
    updated_at = CURRENT_TIMESTAMP
FROM canonical
WHERE mode.type_key = 'MODE'
  AND (
    mode.description IS DISTINCT FROM canonical.purpose
    OR mode.agent_guidance->>'overview' IS DISTINCT FROM canonical.semantic_guidance
  );
