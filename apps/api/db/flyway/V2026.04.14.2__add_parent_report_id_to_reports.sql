ALTER TABLE reports
    ADD COLUMN parent_report_id TEXT;

ALTER TABLE reports
    ADD CONSTRAINT fk_reports_parent_report
    FOREIGN KEY (parent_report_id) REFERENCES reports(id)
    ON DELETE SET NULL;

CREATE INDEX reports_parent_report_idx ON reports (parent_report_id);
