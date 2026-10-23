import { z } from 'zod';
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionConfigV1TypeEnum,
  AgentSessionConfigV1VersionEnum,
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
} from '../../shared/api/generated/api';
import type { ServerLogger } from '../logger';
import type { PlatformAuthContext } from '../platform-auth-context';

const agentSessionConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(AgentSessionConfigV1TypeEnum.CodingSessionV1),
    version: z.literal(AgentSessionConfigV1VersionEnum.V1),
  }),
  z.object({
    type: z.literal(AgentSessionConfigV2TypeEnum.CodingSession),
    version: z.literal(AgentSessionConfigV2VersionEnum.V2),
    model: z.string(),
    taskMonitorId: z.string().optional(),
  }),
  z.object({
    type: z.literal(AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation),
    version: z.literal(AgentSessionConfigEntityConversationV1VersionEnum.V1),
    model: z.string(),
  }),
]);

const agentSessionMonitorStateSchema = z.object({
  conversationId: z.string().min(1).nullable().optional(),
  autoDecide: z.boolean(),
  config: agentSessionConfigSchema.nullable().optional(),
});

const agentSessionEnvelopeSchema = z
  .object({
    data: agentSessionMonitorStateSchema,
  })
  .passthrough();

export type AgentSessionMonitorState = z.infer<typeof agentSessionMonitorStateSchema>;

/**
 * Live AgentSession monitor-state reader. Each call reaches the platform so
 * supervision observes current configuration. Missing sessions return null;
 * transport and validation failures propagate to the owning policy.
 */
export interface AgentSessionReaderDependencies {
  apiBaseUrl: string;
  /** Resolve auth per call; null means there is no token to authorize the read. */
  authProvider: PlatformAuthContext;
  logger: ServerLogger;
  /** Override the platform fetch in tests. */
  fetchImpl?: typeof fetch;
}

interface SafeValueShape {
  typeof: string;
  nullable: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const safeValueShape = (value: unknown): SafeValueShape => ({
  typeof: typeof value,
  nullable: value === null,
});

const safeResponseShape = (body: unknown): Record<string, unknown> => {
  const data = isRecord(body) ? body['data'] : undefined;
  const dataRecord = isRecord(data) ? data : null;
  const config = dataRecord?.['config'];
  const configRecord = isRecord(config) ? config : null;

  return {
    topLevel: safeValueShape(body),
    data: safeValueShape(data),
    fields: {
      conversationId: safeValueShape(dataRecord?.['conversationId']),
      autoDecide: safeValueShape(dataRecord?.['autoDecide']),
      config: safeValueShape(config),
    },
    configFields: {
      type: safeValueShape(configRecord?.['type']),
      version: safeValueShape(configRecord?.['version']),
      model: safeValueShape(configRecord?.['model']),
      taskMonitorId: safeValueShape(configRecord?.['taskMonitorId']),
    },
  };
};

export class AgentSessionReader {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  public constructor(private readonly dependencies: AgentSessionReaderDependencies) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
  }

  public async readAgentSession(
    agentSessionId: string,
    projectId?: string,
  ): Promise<AgentSessionMonitorState | null> {
    const auth = await this.dependencies.authProvider.resolve(projectId);
    if (!auth) {
      throw new Error('AgentSession reader has no auth context');
    }
    const url =
      `${this.baseUrl}/organizations/${encodeURIComponent(auth.organizationId)}` +
      `/projects/${encodeURIComponent(auth.projectId)}` +
      `/agent-sessions/${encodeURIComponent(agentSessionId)}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`AgentSession read failed with status ${String(response.status)}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      this.dependencies.logger.warn('monitors.agent_session_reader.response_json_failed', {
        agentSessionId,
        status: response.status,
        contentType: response.headers.get('content-type'),
        errorType: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
    const parsed = agentSessionEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      this.dependencies.logger.warn('monitors.agent_session_reader.response_invalid', {
        agentSessionId,
        status: response.status,
        contentType: response.headers.get('content-type'),
        validationIssues: parsed.error.issues.map(({ code, path, message }) => ({
          code,
          path,
          message,
        })),
        responseShape: safeResponseShape(body),
      });
      throw new Error('AgentSession read returned an invalid response.');
    }
    return parsed.data.data;
  }
}
