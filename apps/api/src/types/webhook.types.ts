// TypeScript interfaces for webhook payloads and external API responses

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  private: boolean;
  owner: {
    login: string;
    id: number;
    type: 'User' | 'Organization';
  };
}

export interface GitHubWebhookPayload {
  action?: string;
  repository: GitHubRepository;
  sender?: {
    login: string;
    id: number;
    type: 'User' | 'Bot';
  };
  installation?: {
    id: number;
  };
  // Additional fields based on webhook type
  [key: string]: unknown;
}

export interface GitHubWebhookAcceptanceInput {
  payload: GitHubWebhookPayload;
  rawBody: Buffer;
  eventName: string;
  deliveryId: string;
}

export interface GitHubWebhookAcceptanceResult {
  accepted: true;
  duplicate: boolean;
  inboxId: string;
}

export interface JiraProject {
  key: string;
  name: string;
  id: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
}

export interface JiraIssueStatus {
  id: string;
  name: string;
  statusCategory: {
    id: number;
    key: string;
    name: string;
  };
}

export interface JiraIssueFields {
  summary: string;
  description?: string;
  status: JiraIssueStatus;
  assignee?: JiraUser;
  reporter?: JiraUser;
  created: string;
  updated: string;
  issuetype: JiraIssueType;
  project: JiraProject;
  labels: string[];
  priority?: {
    id: string;
    name: string;
  };
  components?: Array<{
    id: string;
    name: string;
  }>;
  fixVersions?: Array<{
    id: string;
    name: string;
  }>;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

export interface JiraWebhookPayload {
  timestamp: number;
  webhookEvent: string;
  issue?: JiraIssue;
  user?: JiraUser;
  changelog?: {
    id: string;
    items: Array<{
      field: string;
      fieldtype: string;
      from?: string;
      to?: string;
      fromString?: string;
      toString?: string;
    }>;
  };
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  email?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
}

export interface SlackMessage {
  type: string;
  subtype?: string;
  text: string;
  user: string;
  ts: string;
  channel: string;
  thread_ts?: string;
}

export interface SlackWebhookPayload {
  token: string;
  team_id: string;
  api_app_id: string;
  event: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    [key: string]: unknown;
  };
  type: 'event_callback' | 'url_verification' | 'app_rate_limited';
  challenge?: string;
  event_id: string;
  event_time: number;
}

// Integration configuration interfaces
export interface GitHubIntegrationConfig {
  token: string;
  installationId?: number;
  repositoryUrl?: string;
  /** Optional GitHub organization (org-level integration) */
  organization?: string;
  webhookSecret?: string;
  privateKey?: string; // For GitHub Apps
}

export interface JiraIntegrationConfig {
  instanceUrl: string;
  apiToken: string;
  email: string;
  projectKeys?: string[];
  issueTypes?: string[];
  webhookSecret?: string;
}

export interface SlackIntegrationConfig {
  botToken: string;
  userToken?: string;
  signingSecret?: string;
  clientSecret?: string;
  teamId?: string;
  channels?: string[];
}

// Generic webhook types
export interface WebhookHeaders {
  'x-hub-signature'?: string;
  'x-hub-signature-256'?: string;
  'x-github-event'?: string;
  'x-github-delivery'?: string;
  'x-slack-signature'?: string;
  'x-slack-request-timestamp'?: string;
  'content-type'?: string;
  'user-agent'?: string;
  [key: string]: string | undefined;
}

export interface WebhookResponse {
  success: boolean;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

// API Response interfaces
export interface GitHubAPIUser {
  login: string;
  id: number;
  avatar_url: string;
  type: 'User' | 'Organization';
  name?: string;
  email?: string;
  company?: string;
}

export interface JiraAPIUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
  active: boolean;
  timeZone?: string;
  locale?: string;
}

export interface SlackAPIResponse {
  ok: boolean;
  error?: string;
  team?: string;
  user?: string;
  url?: string;
  team_id?: string;
  user_id?: string;
}

// Rate limiting interfaces
export interface RateLimitInfo {
  remaining: number;
  reset: number;
  limit: number;
  used?: number;
}

export interface GitHubRateLimitInfo extends RateLimitInfo {
  resource?: 'core' | 'search' | 'graphql';
}

export interface JiraRateLimitInfo extends RateLimitInfo {
  // Jira-specific rate limit fields
}
