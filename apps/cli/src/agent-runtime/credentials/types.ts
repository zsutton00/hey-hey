declare const AGENT_ACCOUNT_ID_BRAND: unique symbol;

export const SUPPORTED_AGENT_TYPES = ['claude', 'codex', 'opencode'] as const;

export type AgentType = (typeof SUPPORTED_AGENT_TYPES)[number];

export type AgentAccountId = string & {
  readonly [AGENT_ACCOUNT_ID_BRAND]: true;
};

export const toAgentAccountId = (value: string): AgentAccountId => value as AgentAccountId;

export interface AgentCredentialMetadata {
  agentType: AgentType;
  accountId: AgentAccountId;
  scopes: string[];
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentCredentialTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string | null;
}

export interface AgentCredentialRecord extends AgentCredentialMetadata, AgentCredentialTokens {}

export interface AgentCredentialInput {
  accountId: AgentAccountId | string;
  accessToken: string;
  refreshToken?: (string | null) | undefined;
  idToken?: (string | null) | undefined;
  tokenType?: (string | null) | undefined;
  scopes: readonly string[];
  expiresAt: number | null;
  createdAt?: number | undefined;
  updatedAt?: number | undefined;
}

export interface CredentialLookup {
  agentType: AgentType;
  accountId: AgentAccountId;
}

export interface CredentialListQuery {
  agentType?: AgentType | undefined;
}

export interface CredentialRefreshResult {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string | null;
  scopes: string[];
  expiresAt: number | null;
}

export interface CredentialRefreshEvent {
  type: 'refreshed';
  agentType: AgentType;
  accountId: AgentAccountId;
  refreshedAt: number;
  expiresAt: number | null;
  scopes: string[];
}

export interface CredentialStoreEvent {
  type: 'stored';
  agentType: AgentType;
  accountId: AgentAccountId;
  updatedAt: number;
}

export interface CredentialDeleteEvent {
  type: 'deleted';
  agentType: AgentType;
  accountId: AgentAccountId;
  deletedAt: number;
}

export type CredentialManagerEvent =
  | CredentialRefreshEvent
  | CredentialStoreEvent
  | CredentialDeleteEvent;

export interface CredentialLifecycleMetadata {
  agentType: AgentType;
  accountId: AgentAccountId;
  scopes: string[];
  expiresAt: number | null;
  lastRetrievedAt: number;
  lastRefreshedAt: number | null;
}

export interface CredentialSessionMetadata {
  credentialLifecycle: CredentialLifecycleMetadata;
}
