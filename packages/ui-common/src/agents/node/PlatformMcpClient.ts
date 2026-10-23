/**
 * Minimal platform MCP client for one-shot tool calls over Streamable HTTP.
 *
 * The platform exposes its tools at an HTTP `/mcp` endpoint using MCP's
 * Streamable HTTP transport. Callers that live OUTSIDE the agent subprocess —
 * e.g. the local CLI mirroring a `create_report` onto its in-memory report
 * chain — need to invoke a single platform tool from their own process.
 *
 * Rather than hand-rolling the JSON-RPC envelope, the content negotiation (the
 * transport answers HTTP 406 unless the request advertises both
 * `application/json` and `text/event-stream`), and the session handshake, this
 * delegates to the official MCP SDK client so the protocol is owned in exactly
 * one place — the same package that already depends on `@modelcontextprotocol/sdk`.
 *
 * Lifecycle: one call == one connect → callTool → close. Intended for
 * infrequent, fire-and-forget tool calls, not a long-lived streaming session.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface PlatformMcpToolContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface PlatformMcpToolCallResult {
  content: PlatformMcpToolContent[];
  isError?: boolean;
}

export interface PlatformMcpToolCallInput {
  /** Fully-formed MCP endpoint URL, e.g. `http://localhost:3000/mcp`. */
  endpointUrl: string;
  /** Platform tool name, e.g. `create_report`. */
  toolName: string;
  /** Tool arguments, forwarded to the platform verbatim. */
  arguments: Record<string, unknown>;
  /**
   * Extra HTTP headers sent on every transport request (auth bearer plus the
   * platform's context headers like `X-Conversation-ID`). The SDK owns
   * `Content-Type`, `Accept`, and the session id; these merge in alongside.
   */
  headers?: Record<string, string>;
}

/**
 * Call a single platform MCP tool over Streamable HTTP and return its result.
 *
 * Connects a fresh client, invokes the tool, and closes — best-effort, so a
 * failed close never masks the tool result or a thrown error. Transport- and
 * protocol-level failures throw (the SDK's `McpError` / transport error);
 * tool-level failures come back as a result with `isError: true`, which the
 * caller is responsible for interpreting.
 */
export async function callPlatformMcpTool(
  input: PlatformMcpToolCallInput
): Promise<PlatformMcpToolCallResult> {
  const transport = new StreamableHTTPClientTransport(
    new URL(input.endpointUrl),
    {
      requestInit: input.headers ? { headers: input.headers } : undefined,
    }
  );
  const client = new Client(
    { name: "heyhey-platform-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: input.toolName,
      arguments: input.arguments,
    });
    return result as PlatformMcpToolCallResult;
  } finally {
    await client.close().catch(() => {
      // Best-effort cleanup: a failed close must not mask the call's outcome.
    });
  }
}
