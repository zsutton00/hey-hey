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
  /** The API is a staging or local deployment, where Hey Hey itself is developed. */
  productDevelopment: boolean;
}

const PRODUCT_DEVELOPMENT_META_KEY = 'heyhey/productDevelopment';

/**
 * Reads hint availability and the deployment environment from the platform tool
 * list. Hints are offered when `create_hint` is listed. The API marks its
 * always-listed tools with `_meta['heyhey/productDevelopment']: true` on staging
 * and local deployments; any listed tool carrying it counts, so the signal does
 * not depend on hint tools. Anything other than an explicit `true` is not
 * product development, so production never receives the extra rules. Throws on any failed or malformed
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

  const productDevelopment = parsed.data.result.tools.some(
    (tool) => tool._meta?.[PRODUCT_DEVELOPMENT_META_KEY] === true,
  );

  return { enabled: createHint !== undefined, productDevelopment };
};
