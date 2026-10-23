-- Publish the placement, launch-eligibility, and freshness semantics on the
-- project-effective MODE agent-guidance axis without changing any other MODE
-- definition axis.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot publish MODE freshness guidance; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT
    $mode_freshness_marker$## MODE placement, eligibility, and freshness$mode_freshness_marker$::text AS marker,
    $mode_freshness_guidance$
## MODE placement, eligibility, and freshness

Every MODE has one structural owning Feature. Structural parentage locates the MODE and identifies the capability whose evolution should trigger a freshness review; it does not restrict launch eligibility. RELATED_TO is also navigational and never filters launch.

Only outbound MODE-to-Feature DEPENDS_ON relationships restrict Feature eligibility. Each dependency makes the MODE eligible for the target Feature and its descendants. A MODE with no outbound Feature DEPENDS_ON is project-global. Feature eligibility intersects with the MODE's agentGuidance.contexts[].focalTypeKeys work-item-type compatibility; neither axis replaces the other.

Keep MODE.md and supporting text files current as requirements, decisions, and completed work evolve on either the owning Feature or a Feature covered by outbound DEPENDS_ON applicability. Surface stale content through targeted, user-reviewable MODE proposals. Never mutate MODE content directly, and do not alter immutable bundles already captured by Agent Sessions.
$mode_freshness_guidance$::text AS body
)
UPDATE work_item_type_template AS mode
SET agent_guidance = jsonb_set(
  COALESCE(mode.agent_guidance, '{}'::jsonb),
  '{overview}',
  to_jsonb(
    CASE
      WHEN COALESCE(mode.agent_guidance->>'overview', '') LIKE '%' || guidance.marker || '%'
        THEN mode.agent_guidance->>'overview'
      ELSE concat_ws(E'\n\n', NULLIF(mode.agent_guidance->>'overview', ''), guidance.body)
    END
  ),
  true
),
updated_at = CURRENT_TIMESTAMP
FROM guidance
WHERE mode.type_key = 'MODE'
  AND COALESCE(mode.agent_guidance->>'overview', '') NOT LIKE '%' || guidance.marker || '%';

WITH guidance AS (
  SELECT
    $mode_freshness_marker$## MODE placement, eligibility, and freshness$mode_freshness_marker$::text AS marker,
    $mode_freshness_guidance$
## MODE placement, eligibility, and freshness

Every MODE has one structural owning Feature. Structural parentage locates the MODE and identifies the capability whose evolution should trigger a freshness review; it does not restrict launch eligibility. RELATED_TO is also navigational and never filters launch.

Only outbound MODE-to-Feature DEPENDS_ON relationships restrict Feature eligibility. Each dependency makes the MODE eligible for the target Feature and its descendants. A MODE with no outbound Feature DEPENDS_ON is project-global. Feature eligibility intersects with the MODE's agentGuidance.contexts[].focalTypeKeys work-item-type compatibility; neither axis replaces the other.

Keep MODE.md and supporting text files current as requirements, decisions, and completed work evolve on either the owning Feature or a Feature covered by outbound DEPENDS_ON applicability. Surface stale content through targeted, user-reviewable MODE proposals. Never mutate MODE content directly, and do not alter immutable bundles already captured by Agent Sessions.
$mode_freshness_guidance$::text AS body
)
UPDATE work_item_type AS mode
SET agent_guidance = jsonb_set(
  COALESCE(mode.agent_guidance, '{}'::jsonb),
  '{overview}',
  to_jsonb(
    CASE
      WHEN COALESCE(mode.agent_guidance->>'overview', '') LIKE '%' || guidance.marker || '%'
        THEN mode.agent_guidance->>'overview'
      ELSE concat_ws(E'\n\n', NULLIF(mode.agent_guidance->>'overview', ''), guidance.body)
    END
  ),
  true
),
updated_at = CURRENT_TIMESTAMP
FROM guidance
WHERE mode.type_key = 'MODE'
  AND mode.project_id IS NOT NULL
  AND mode.lifecycle_status = 'active'
  AND COALESCE(mode.agent_guidance->>'overview', '') NOT LIKE '%' || guidance.marker || '%';
