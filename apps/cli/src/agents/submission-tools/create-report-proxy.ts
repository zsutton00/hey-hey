import type { RunStore } from '../../run-store/run-store';
/**
 * Thin proxy client that POSTs to the platform report REST endpoint.
 *
 * The CLI exposes a `create_report` submission tool to local agents. The tool
 * returns MCP content because the local submission-tools transport is MCP, but
 * persistence itself is REST: POST /organizations/{organizationId}/reports.
 * This module owns auth/context headers, response narrowing, agent-facing
 * content construction, and the monitor emission tap so wrappers can stay
 * focused on Run report-chain bookkeeping.
 *
 * On an HTTP error or unparseable success payload, the proxy throws — wrappers
 * deliberately do not append a chain entry on failure, since there is no
 * canonical platform-side report id to record.
 */

import { z } from 'zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {
  ApiErrorResponse,
  CreateReportCompletedAttemptError,
} from '../../shared/api/generated/api';
import { reportErrorSchemas } from '../../shared/api/generated/report-error-schemas';
import { extractOrganizationIdFromToken } from '../../auth/index';
import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';
import type { ReportEmissionEvents } from './report-emission-events';
import type { SubmissionToolAuth } from './submission-tool-auth';
import type { SubmissionToolMcpContent } from './types';

const reportGuidanceSchema = z.object({
  actions: z.array(z.string()),
});

const errorValidator = new Ajv({ strict: false });
addFormats(errorValidator);
const parsePlatformError = errorValidator.compile<ApiErrorResponse>(
  reportErrorSchemas.ApiErrorResponse,
);
const parseCompletedAttempt = errorValidator.compile<CreateReportCompletedAttemptError>(
  reportErrorSchemas.CreateReportCompletedAttemptError,
);

const reportResourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    mention: z.string().min(1).optional(),
    reportGuidance: reportGuidanceSchema.optional(),
  })
  .passthrough();

const createReportRestResponseSchema = z
  .object({
    data: reportResourceSchema.optional(),
    id: z.string().min(1).optional(),
    reportId: z.string().min(1).optional(),
    mention: z.string().min(1).optional(),
    reportGuidance: reportGuidanceSchema.optional(),
  })
  .passthrough();

const platformReportPayloadSchema = z.object({
  reportId: z.string().min(1),
  mention: z.string().min(1),
  reportGuidance: reportGuidanceSchema.optional(),
});

export interface CreateReportProxyOptions {
  runStore?: RunStore;
  /**
   * Resolve a fresh platform OAuth bearer token. Called per request so
   * proxied calls inherit refreshed tokens.
   */
  auth: SubmissionToolAuth;
  /**
   * Normalized REST base URL — must already include the `/api/v1` segment.
   * The CLI bootstrap derives this once via the same `normalizedApiBaseUrl`
   * other server-side adapters use.
   */
  apiBaseUrl: string;
  /**
   * fetch implementation. Defaulted to global `fetch` in production wiring;
   * tests inject a fake so no network is exercised.
   */
  fetchImpl?: typeof fetch;
  /** Logger for failures in the post-persistence local lifecycle side channel. */
  logger?: ServerLogger;
  /**
   * Lifecycle channel published once per successful report creation, carrying
   * the emitting run and the new report id. Monitor ownership subscribes after
   * it is constructed. Published only after the platform confirms the report
   * and a report id is parsed — never on a tool error or unparseable response.
   */
  reportEmissionEvents: ReportEmissionEvents;
}

export interface CreateReportProxyInput {
  readonly inert?: boolean;
  /**
   * Active Run id — propagated as `X-Agent-Session-ID` so the platform
   * stamps `sourceExecutionId` on the created report.
   */
  runId: string;
  /**
   * Active conversation id — propagated as `X-Conversation-ID` so the
   * platform's auto-attach populates the report's Conversation reference.
   * Required: the proxy only runs from inside an active Run, which always
   * has a `conversationId`. Mirrors the header set by `mcp-server-config.ts`
   * for Claude-spawn MCP calls.
   */
  conversationId: string;
  /**
   * Active project id — propagated as `X-Project-ID`. The platform's
   * native `create_report` resolves the report's project EXCLUSIVELY from
   * this header (it calls `resolveProjectId({}, request)` and omits
   * `projectId` from its tool schema), so a `projectId` tool argument is
   * ignored — the header is the only path. Required: a Run always carries
   * a non-null `projectId`. Mirrors the header `mcp-server-config.ts` sets
   * for Claude-spawn MCP calls.
   */
  projectId: string;
  /**
   * Arguments supplied by the agent-facing wrapper. The proxy sends these to
   * the REST endpoint and stamps `projectId` from the active Run so the REST
   * payload and context headers agree. May include run-stamped report envelope
   * metadata such as `agent`.
   */
  args: Record<string, unknown>;
}

export interface CreateReportProxyResult {
  /**
   * MCP content blocks constructed from the platform REST response. Forwarded
   * to the agent by the wrapper.
   */
  content: ReadonlyArray<SubmissionToolMcpContent>;
  /**
   * The newly-created report id, parsed from the platform response. Used
   * to construct the Run's `ReportChainEntry` after a successful proxy
   * call. Throws (does not return) when the platform succeeds but no id is
   * derivable — appending a chain entry without an id would corrupt the
   * Run's report-chain invariant.
   */
  reportId: string;
}

export class CreateReportProxyError extends Error {
  readonly code:
    | 'TOOL_ERROR'
    | 'INVALID_RESPONSE'
    | 'MISSING_REPORT_ID'
    | 'MISSING_ORGANIZATION_ID';
  readonly details: unknown;
  constructor(code: CreateReportProxyError['code'], message: string, details: unknown = undefined) {
    super(message);
    this.name = 'CreateReportProxyError';
    this.code = code;
    this.details = details;
  }
}

/**
 * True when the platform answered 2xx before the proxy failed, so the report
 * was persisted even though no report id reached the caller. Every other
 * failure means the platform did not confirm persistence.
 */
export const isCreateReportPersistedFailure = (error: unknown): boolean =>
  error instanceof CreateReportProxyError &&
  (error.code === 'INVALID_RESPONSE' || error.code === 'MISSING_REPORT_ID');

const buildEndpointUrl = (apiBaseUrl: string, organizationId: string): string => {
  const trimmed = apiBaseUrl.replace(/\/$/u, '');
  return `${trimmed}/organizations/${encodeURIComponent(organizationId)}/reports`;
};

const buildReportMention = (reportId: string, mention?: string): string =>
  mention ?? `@[report:${reportId}|Report]`;

const buildAgentContent = (payload: z.infer<typeof platformReportPayloadSchema>) => [
  { type: 'text', text: JSON.stringify(payload) },
];

const readRestPayload = (parsed: z.infer<typeof createReportRestResponseSchema>) => {
  const reportId = parsed.reportId ?? parsed.id ?? parsed.data?.id;
  if (!reportId) {
    throw new CreateReportProxyError(
      'MISSING_REPORT_ID',
      'Platform create_report REST response did not include a report id',
      parsed,
    );
  }

  const payload = platformReportPayloadSchema.parse({
    reportId,
    mention: buildReportMention(reportId, parsed.mention ?? parsed.data?.mention),
    reportGuidance: parsed.reportGuidance ?? parsed.data?.reportGuidance,
  });

  return payload;
};

export class CreateReportProxy {
  private readonly runStore: RunStore | undefined;
  private readonly auth: SubmissionToolAuth;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly reportEmissionEvents: ReportEmissionEvents;
  private readonly logger: ServerLogger;

  public constructor(options: CreateReportProxyOptions) {
    this.runStore = options.runStore;
    this.auth = options.auth;
    this.apiBaseUrl = options.apiBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.reportEmissionEvents = options.reportEmissionEvents;
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  public async create(input: CreateReportProxyInput): Promise<CreateReportProxyResult> {
    const stored = await this.runStore?.getRunMetadata(input.runId);
    if (this.runStore && !stored) {
      throw new Error('Cannot submit report without persisted execution metadata.');
    }
    const inert = stored?.inert === true || input.inert === true;
    const token = await this.auth.getAccessToken();
    const organizationId = extractOrganizationIdFromToken(token);
    if (!organizationId) {
      throw new CreateReportProxyError(
        'MISSING_ORGANIZATION_ID',
        'Platform create_report could not resolve an organization id from the access token',
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Organization-ID': organizationId,
      'X-Agent-Session-ID': input.runId,
      'X-Conversation-ID': input.conversationId,
      'X-Project-ID': input.projectId,
    };

    const response = await this.fetchImpl(buildEndpointUrl(this.apiBaseUrl, organizationId), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...input.args,
        projectId: input.projectId,
        ...(inert ? { ragEnabled: false } : {}),
      }),
    });

    const rawText = await response.text();
    let completedReportId: string | undefined;
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = JSON.parse(rawText);
      } catch {
        errorBody = null;
      }
      if (response.status === 409 && parseCompletedAttempt(errorBody)) {
        const provenance = input.args['payload'];
        const attempt =
          typeof provenance === 'object' && provenance !== null && 'provenance' in provenance
            ? provenance.provenance
            : null;
        if (
          input.args['reportType'] === 'PROJECT_REPORT' &&
          typeof attempt === 'object' &&
          attempt !== null &&
          'requestId' in attempt &&
          'attemptId' in attempt &&
          attempt.requestId === errorBody.data.requestId &&
          attempt.attemptId === errorBody.data.attemptId
        ) {
          completedReportId = errorBody.data.reportId;
          this.logger.debug('local.run.create_report.project_report.completed_attempt_recovered', {
            runId: input.runId,
            reportId: completedReportId,
            requestId: errorBody.data.requestId,
            attemptId: errorBody.data.attemptId,
          });
        }
      }
      if (!completedReportId) {
        throw new CreateReportProxyError(
          'TOOL_ERROR',
          `Platform create_report returned HTTP ${response.status}${parsePlatformError(errorBody) ? `: ${errorBody.message}` : ''}`,
          { status: response.status },
        );
      }
    }

    let parsedJson: unknown;
    try {
      parsedJson = completedReportId
        ? { reportId: completedReportId }
        : rawText.length === 0
          ? null
          : JSON.parse(rawText);
    } catch (error) {
      throw new CreateReportProxyError(
        'INVALID_RESPONSE',
        'Platform create_report REST response body is not valid JSON',
        error,
      );
    }

    const parsed = createReportRestResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new CreateReportProxyError(
        'INVALID_RESPONSE',
        'Platform create_report REST response did not match the expected envelope',
        parsed.error.issues,
      );
    }

    const payload = readRestPayload(parsed.data);
    const content = buildAgentContent(payload);

    try {
      if (!inert && input.args['ragEnabled'] !== false) {
        this.reportEmissionEvents.publish({
          runId: input.runId,
          reportId: payload.reportId,
          ...(typeof input.args['reportType'] === 'string'
            ? { reportType: input.args['reportType'] }
            : {}),
        });
      }
    } catch (error) {
      this.logger.warn('local.run.create_report.emission_listener_failed_after_persist', {
        runId: input.runId,
        reportId: payload.reportId,
        error: error instanceof Error ? error.message : 'Unknown listener failure',
      });
    }

    return {
      content,
      reportId: payload.reportId,
    };
  }
}
