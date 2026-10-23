-- Every triage Run now creates its own Agent Session; the one-per-user
-- mapping is no longer read or written.
DROP TABLE IF EXISTS "open_items_triage_sessions";
