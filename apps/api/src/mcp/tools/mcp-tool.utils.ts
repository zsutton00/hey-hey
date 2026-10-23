import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  AgentSessionId,
  OrganizationId,
  ProjectId,
  ServiceId,
} from '../../types';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

export interface AuthContext {
  user: AuthenticatedUser;
  organizationId: OrganizationId;
  token: string | null;
}

export function mcpError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function extractAuthContext(
  params: { organizationId?: string },
  request: Request,
): AuthContext | CallToolResult {
  const user = request.user as AuthenticatedUser | undefined;
  if (!user) {
    return mcpError('Authentication required.');
  }

  const organizationId =
    (params.organizationId as OrganizationId) ?? user.currentOrgId;
  if (!organizationId) {
    return mcpError(
      'Missing organizationId: provide it as a parameter ' +
        'or ensure your account has a current organization.',
    );
  }

  const authHeader = request.headers?.authorization as string | undefined;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : ((request as any).cookies?.accessToken ?? null);

  return { user, organizationId, token };
}

export function isAuthContext(
  value: AuthContext | CallToolResult,
): value is AuthContext {
  return 'user' in value && 'organizationId' in value && 'token' in value;
}

export const paginationFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum number of results to return'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Offset for paginating results'),
};

export function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve projectId from tool params or X-Project-ID header.
 * Returns a ProjectId or a CallToolResult error.
 */
export function resolveProjectId(
  params: { projectId?: string },
  request: Request,
): ProjectId | CallToolResult {
  const projectId =
    params.projectId ??
    (request.headers?.['x-project-id'] as string | undefined);
  if (!projectId) {
    return mcpError(
      'Missing projectId: provide it as a parameter ' +
        'or ensure the X-Project-ID header is set.',
    );
  }
  if (!UUID_RE.test(projectId)) {
    return mcpError(`Invalid projectId: "${projectId}" is not a valid UUID.`);
  }
  return projectId as ProjectId;
}

export function isProjectId(
  value: ProjectId | CallToolResult,
): value is ProjectId {
  return typeof value === 'string';
}

/**
 * Resolve serviceId from tool params or X-Service-ID header.
 * Returns a ServiceId or a CallToolResult error.
 */
export function resolveServiceId(
  params: { serviceId?: string },
  request: Request,
): ServiceId | CallToolResult {
  const serviceId =
    params.serviceId ?? (request.headers['x-service-id'] as string | undefined);
  if (!serviceId) {
    return mcpError(
      'Missing serviceId: provide it as a parameter ' +
        'or ensure the X-Service-ID header is set.',
    );
  }
  return serviceId as ServiceId;
}

export function isServiceId(
  value: ServiceId | CallToolResult,
): value is ServiceId {
  return typeof value === 'string';
}

/**
 * Read an optional UUID-shaped header. Returns undefined when the header is
 * absent (caller treats this as "no context"), the validated UUID string when
 * present and well-formed, or a CallToolResult error when present but malformed
 * (which always indicates a misconfigured caller — we surface it loudly rather
 * than silently dropping the value).
 */
export function readOptionalUuidHeader(
  request: Request,
  headerName: string,
  label: string,
): string | undefined | CallToolResult {
  const value = request.headers[headerName] as string | undefined;
  if (!value) return undefined;
  if (!UUID_RE.test(value)) {
    return mcpError(`Invalid ${label}: "${value}" is not a valid UUID.`);
  }
  return value;
}

/**
 * Resolve agentSessionId from the X-Agent-Session-ID request header.
 * Returns an AgentSessionId or a CallToolResult error.
 */
export function resolveAgentSessionId(
  request: Request,
): AgentSessionId | CallToolResult {
  const sessionId = request.headers['x-agent-session-id'] as string | undefined;
  if (!sessionId) {
    return mcpError(
      'Missing agent session: ensure the X-Agent-Session-ID header is set.',
    );
  }
  if (!UUID_RE.test(sessionId)) {
    return mcpError(
      `Invalid agent session ID: "${sessionId}" is not a valid UUID.`,
    );
  }
  return sessionId as AgentSessionId;
}

export function isAgentSessionId(
  value: AgentSessionId | CallToolResult,
): value is AgentSessionId {
  return typeof value === 'string';
}
