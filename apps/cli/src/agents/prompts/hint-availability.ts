import { z } from 'zod';
import { buildMcpHeaders, qualifyMcpToolName, resolveMcpEndpointUrl } from '../mcp-server-config';

const toolsListResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

/**
 * Reads whether the platform offers hints. The API's deployment-wide
 * `HINTS_ENABLED` flag decides: when it is off the hint tools are absent from
 * the platform tool list, so `create_hint` being listed is the signal. Throws
 * on any failed or malformed read so session start aborts loudly.
 */
export const readHintsEnabled = async (
  accessToken: string,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
  const response = await fetchImpl(resolveMcpEndpointUrl(), {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...buildMcpHeaders(accessToken, { projectId }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'hints-enabled', method: 'tools/list' }),
  });
  if (!response.ok) {
    throw new Error(`Cannot start session: platform tool list failed (${String(response.status)}).`);
  }
  const parsed = toolsListResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Cannot start session: platform tool list was invalid (${parsed.error.message}).`,
    );
  }
  return parsed.data.result.tools.some(
    (tool) => tool.name === 'create_hint' || tool.name === qualifyMcpToolName('create_hint'),
  );
};
