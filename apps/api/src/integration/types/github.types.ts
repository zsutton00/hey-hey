export interface GitHubConfig {
  token: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  scope?: string;
  tokenType?: string;
  owner: string; // User or organization name
  repositoryUrl?: string; // Optional full URL to a specific repository
  organization?: string;
  primaryRepository?: {
    fullName: string;
    owner: string;
    defaultBranch: string;
  };
  webhookSecret?: string;
  webhookEvents?: string[];
}

// TODO: Replace with Octokit response types once @octokit/types is available.
export interface GitHubRepositoryApiResponse {
  name?: string;
  full_name?: string;
  description?: string | null;
  html_url?: string;
  default_branch?: string;
  owner?: { login?: string };
}

export type GithubEntityType = 'User' | 'Organization';

export interface GitHubArtifact {
  type: 'pull_request' | 'issue' | 'commit' | 'discussion';
  githubId: string;
  title: string;
  body: string;
  author: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string; // GitHub API returns string, can be 'open', 'closed', etc.
  html_url: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    avatar_url: string;
  } | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  draft?: boolean;
  [key: string]: unknown; // Allow additional GitHub API fields
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null | undefined;
  state: string; // GitHub API returns string, can be 'open', 'closed', etc.
  html_url: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    avatar_url: string;
  } | null;
  labels: Array<{
    name: string;
    color: string;
    [key: string]: unknown;
  }>;
  pull_request?: unknown; // GitHub API includes this field to distinguish PRs from issues
  [key: string]: unknown; // Allow additional GitHub API fields
}

export interface GitHubRepository {
  owner: string;
  repo: string;
  fullName: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  // ... existing code ...
}
