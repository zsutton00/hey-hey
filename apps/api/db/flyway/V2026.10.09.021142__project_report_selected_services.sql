-- NULL preserves unknown repository scope on historical requests.
ALTER TABLE project_report_requests ADD COLUMN service_ids jsonb;
ALTER TABLE project_report_requests ADD CONSTRAINT project_report_service_ids_array
  CHECK (service_ids IS NULL OR (jsonb_typeof(service_ids) = 'array' AND jsonb_array_length(service_ids) > 0));
