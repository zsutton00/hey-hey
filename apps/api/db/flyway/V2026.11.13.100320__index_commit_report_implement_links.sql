CREATE INDEX reports_commit_payload_links_idx ON reports USING gin (payload jsonb_path_ops) WHERE report_type = 'COMMIT';
