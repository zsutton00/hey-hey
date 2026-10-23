-- Per-call observability for MCP tool invocations. One row per non-excluded
-- `tools/call` request, written after the response finishes so logging never
-- affects the agent's request path. agent_session_id is optional context
-- (set from the X-Agent-Session-ID header) and intentionally unconstrained —
-- it is a soft reference, not a foreign key.

-- CreateTable
CREATE TABLE "mcp_tool_call_logs" (
    "id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_session_id" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "response_size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_tool_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_tool_call_logs_organization_id_created_at_idx" ON "mcp_tool_call_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "mcp_tool_call_logs_agent_session_id_created_at_idx" ON "mcp_tool_call_logs"("agent_session_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "mcp_tool_call_logs_tool_name_created_at_idx" ON "mcp_tool_call_logs"("tool_name", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "mcp_tool_call_logs" ADD CONSTRAINT "mcp_tool_call_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
