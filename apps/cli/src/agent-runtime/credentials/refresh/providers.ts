import { z } from 'zod';
import type { AgentCredentialRecord, AgentType, CredentialRefreshResult } from '../types';
import { CredentialError, classifyRefreshStatus } from '../errors';

export interface RefreshExecutionContext {
  signal?: AbortSignal | undefined;
}

export interface AgentCredentialRefresher {
  refresh(
    credential: AgentCredentialRecord,
    context?: RefreshExecutionContext,
  ): Promise<CredentialRefreshResult>;
}

export type FetchLike = typeof fetch;

const codexRefreshSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

const claudeRefreshSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

const parseScopes = (rawScope: string | undefined, fallback: string[]): string[] => {
  if (!rawScope || rawScope.trim().length === 0) {
    return fallback;
  }

  return rawScope
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
};

const calculateExpiration = (
  expiresInSeconds: number | undefined,
  fallbackExpiresAt: number | null,
): number | null => {
  if (typeof expiresInSeconds !== 'number') {
    return fallbackExpiresAt;
  }

  return Date.now() + expiresInSeconds * 1_000;
};

const parseJsonSafely = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const extractOauthErrorCode = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as {
    error?: unknown | undefined;
  };
  if (typeof candidate.error === 'string' && candidate.error.trim().length > 0) {
    return candidate.error.trim().toLowerCase();
  }

  return null;
};

const isInvalidCredentialResponse = (
  statusCode: number,
  oauthErrorCode: string | null,
  rawBody: string,
): boolean => {
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  if (statusCode !== 400) {
    return false;
  }

  if (oauthErrorCode === 'invalid_grant' || oauthErrorCode === 'invalid_token') {
    return true;
  }

  const normalizedBody = rawBody.toLowerCase();
  return (
    normalizedBody.includes('invalid_grant') || normalizedBody.includes('invalid refresh token')
  );
};

const parseResponseOrThrow = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    const rawBody = await response.text();
    const parsedBody = parseJsonSafely(rawBody);
    const oauthErrorCode = extractOauthErrorCode(parsedBody);
    const errorCode = isInvalidCredentialResponse(response.status, oauthErrorCode, rawBody)
      ? 'INVALID_CREDENTIAL'
      : classifyRefreshStatus(response.status);

    throw new CredentialError(
      errorCode,
      `Token refresh request failed with status ${response.status}`,
      { statusCode: response.status, reason: oauthErrorCode ?? undefined },
    );
  }

  return response.json();
};

const ensureRefreshToken = (credential: AgentCredentialRecord): string => {
  if (!credential.refreshToken) {
    throw new CredentialError(
      'INVALID_CREDENTIAL',
      'Refresh token is missing for this credential',
      { reason: 'missing_refresh_token' },
    );
  }

  return credential.refreshToken;
};

export interface CodexRefresherOptions {
  clientId?: string | undefined;
  tokenUrl?: string | undefined;
  fetchImplementation?: FetchLike | undefined;
}

export const createCodexCredentialRefresher = (
  options: CodexRefresherOptions = {},
): AgentCredentialRefresher => {
  const clientId = options.clientId ?? 'app_EMoamEEZ73f0CkXaXp7hrann';
  const tokenUrl = options.tokenUrl ?? 'https://auth.openai.com/oauth/token';
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async refresh(credential, context) {
      const refreshToken = ensureRefreshToken(credential);
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      });

      const response = await fetchImplementation(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        ...(context?.signal ? { signal: context.signal } : {}),
      });

      const rawPayload = await parseResponseOrThrow(response);
      const payload = codexRefreshSchema.parse(rawPayload);

      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token ?? refreshToken,
        idToken: payload.id_token ?? credential.idToken,
        tokenType: payload.token_type ?? credential.tokenType,
        scopes: parseScopes(payload.scope, credential.scopes),
        expiresAt: calculateExpiration(payload.expires_in, credential.expiresAt),
      };
    },
  };
};

export interface ClaudeRefresherOptions {
  clientId?: string | undefined;
  tokenUrl?: string | undefined;
  fetchImplementation?: FetchLike | undefined;
}

export const createClaudeCredentialRefresher = (
  options: ClaudeRefresherOptions = {},
): AgentCredentialRefresher => {
  const clientId = options.clientId ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
  const tokenUrl = options.tokenUrl ?? 'https://console.anthropic.com/v1/oauth/token';
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async refresh(credential, context) {
      const refreshToken = ensureRefreshToken(credential);
      const response = await fetchImplementation(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
        ...(context?.signal ? { signal: context.signal } : {}),
      });

      const rawPayload = await parseResponseOrThrow(response);
      const payload = claudeRefreshSchema.parse(rawPayload);

      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token ?? refreshToken,
        idToken: credential.idToken,
        tokenType: payload.token_type ?? credential.tokenType,
        scopes: parseScopes(payload.scope, credential.scopes),
        expiresAt: calculateExpiration(payload.expires_in, credential.expiresAt),
      };
    },
  };
};

export interface HeyHeyCredentialRefreshApiClient {
  refreshAgentCredential?:
    | ((
        agentType: AgentType,
        credential: AgentCredentialRecord,
      ) => Promise<Partial<CredentialRefreshResult>>)
    | undefined;
  refreshClaudeCredential?:
    | ((credential: AgentCredentialRecord) => Promise<Partial<CredentialRefreshResult>>)
    | undefined;
  refreshCodexCredential?:
    | ((credential: AgentCredentialRecord) => Promise<Partial<CredentialRefreshResult>>)
    | undefined;
}

const mergeRefreshResult = (
  credential: AgentCredentialRecord,
  partial: Partial<CredentialRefreshResult>,
): CredentialRefreshResult => {
  if (!partial.accessToken || partial.accessToken.trim().length === 0) {
    throw new CredentialError('REFRESH_FAILED', 'Refresh response did not include an access token');
  }

  return {
    accessToken: partial.accessToken,
    refreshToken: partial.refreshToken ?? credential.refreshToken,
    idToken: partial.idToken ?? credential.idToken,
    tokenType: partial.tokenType ?? credential.tokenType,
    scopes: partial.scopes ?? credential.scopes,
    expiresAt: partial.expiresAt === undefined ? credential.expiresAt : partial.expiresAt,
  };
};

export const createHeyHeyApiCredentialRefresher = (
  agentType: AgentType,
  apiClient: HeyHeyCredentialRefreshApiClient,
): AgentCredentialRefresher => ({
  async refresh(credential) {
    const genericResult = apiClient.refreshAgentCredential
      ? await apiClient.refreshAgentCredential(agentType, credential)
      : null;

    const providerResult =
      agentType === 'claude'
        ? await apiClient.refreshClaudeCredential?.(credential)
        : await apiClient.refreshCodexCredential?.(credential);

    const result = providerResult ?? genericResult;
    if (!result) {
      throw new CredentialError('REFRESH_FAILED', `No refresh method available for ${agentType}`);
    }

    return mergeRefreshResult(credential, result);
  },
});
