import { z } from 'zod';
import { buildMcpHeaders, qualifyMcpToolName, resolveMcpEndpointUrl } from '../mcp-server-config';

const toolsListResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.object({
    tools: z.array(z.object({ name: z.string(), _meta: z.record(z.unknown()).optional() })),
  }),
});

/** What the platform tool list says about hints for this deployment. */
export interface HintAvailability {
  /** The platform offers the hint tools. */
  enabled: boolean;
  /** The API is a staging or local deployment, where product defects can be fixed. */
  productDevelopment: boolean;
}

const PRODUCT_DEVELOPMENT_META_KEY = 'heyhey/productDevelopment';

/**
 * Reads hint availability from the platform tool list. Hints are offered when
 * `create_hint` is listed; the API marks that tool with
 * `_meta['heyhey/productDevelopment']: true` on staging and local deployments.
 * Anything other than an explicit `true` is not product development, so
 * production never receives the extra rule. Throws on any failed or malformed
 * read so session start aborts loudly.
 */
export const readHintAvailability = async (
  accessToken: string,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HintAvailability> => {
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
    throw new Error(
      `Cannot start session: platform tool list failed (${String(response.status)}).`,
    );
  }
  const parsed = toolsListResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Cannot start session: platform tool list was invalid (${parsed.error.message}).`,
    );
  }
  const createHint = parsed.data.result.tools.find(
    (tool) => tool.name === 'create_hint' || tool.name === qualifyMcpToolName('create_hint'),
  );

  return {
    enabled: createHint !== undefined,
    productDevelopment: createHint?._meta?.[PRODUCT_DEVELOPMENT_META_KEY] === true,
  };
};
