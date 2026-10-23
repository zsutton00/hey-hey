-- The MCP tool-call log was durable tool-usage telemetry. The private-beta
-- boundary permits live delivery and payload-free operational logging, but it
-- does not permit this telemetry to become a database record. Remove the
-- unused store after the write path is removed from the API.
DROP TABLE IF EXISTS "mcp_tool_call_logs";
