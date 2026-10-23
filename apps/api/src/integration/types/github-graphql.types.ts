/**
 * GraphQL query types and interfaces for GitHub API
 */

export interface GitHubGraphQLRepository {
  id: string;
  name: string;
  owner: {
    login: string;
  };
  defaultBranch: {
    name: string;
  } | null;
  readme?: {
    text: string;
    oid: string;
  } | null;
  docs?: {
    entries: Array<{
      name: string;
      type: string;
      object?: {
        text: string;
        oid: string;
      } | null;
    }>;
  } | null;
  issues: {
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
    nodes: GitHubGraphQLIssue[];
  };
  pullRequests: {
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
    nodes: GitHubGraphQLPullRequest[];
  };
}

export interface GitHubGraphQLIssue {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  author: {
    login: string;
  } | null;
  labels: {
    nodes: Array<{
      name: string;
    }>;
  };
  assignees: {
    nodes: Array<{
      login: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  url: string;
  comments: {
    totalCount: number;
  };
}

export interface GitHubGraphQLPullRequest {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  author: {
    login: string;
  } | null;
  labels: {
    nodes: Array<{
      name: string;
    }>;
  };
  assignees: {
    nodes: Array<{
      login: string;
    }>;
  };
  reviewRequests: {
    nodes: Array<{
      requestedReviewer: {
        login: string;
      } | null;
    }>;
  };
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  url: string;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: {
    nodes: Array<{
      path: string;
      additions: number;
      deletions: number;
      changeType: string;
    }>;
  };
  comments: {
    totalCount: number;
    nodes: Array<{
      author: {
        login: string;
      } | null;
      body: string;
    }>;
  };
}

export interface GitHubGraphQLResponse {
  repository: GitHubGraphQLRepository;
}

export interface GitHubGraphQLError {
  message: string;
  type: string;
  path: string[];
}

// Type guards for runtime validation
export function isValidGitHubRepository(
  data: unknown,
): data is GitHubGraphQLRepository {
  if (!data || typeof data !== 'object') return false;
  const repo = data as Record<string, unknown>;

  return (
    typeof repo.id === 'string' &&
    typeof repo.name === 'string' &&
    repo.owner !== null &&
    typeof repo.owner === 'object' &&
    typeof (repo.owner as Record<string, unknown>).login === 'string'
  );
}

export function isValidGitHubIssue(data: unknown): data is GitHubGraphQLIssue {
  if (!data || typeof data !== 'object') return false;
  const issue = data as Record<string, unknown>;

  return (
    typeof issue.id === 'string' &&
    typeof issue.number === 'number' &&
    typeof issue.title === 'string' &&
    typeof issue.state === 'string' &&
    typeof issue.createdAt === 'string' &&
    typeof issue.url === 'string'
  );
}

export function isValidGitHubPullRequest(
  data: unknown,
): data is GitHubGraphQLPullRequest {
  if (!data || typeof data !== 'object') return false;
  const pr = data as Record<string, unknown>;

  return (
    typeof pr.id === 'string' &&
    typeof pr.number === 'number' &&
    typeof pr.title === 'string' &&
    typeof pr.state === 'string' &&
    typeof pr.createdAt === 'string' &&
    typeof pr.url === 'string' &&
    typeof pr.baseRefName === 'string' &&
    typeof pr.headRefName === 'string'
  );
}

// Safe accessors for potentially null/undefined GitHub API fields
export function safeGetLogin(
  author: { login: string } | null | undefined,
): string {
  return author?.login || 'Unknown';
}

export function safeGetLabels(
  labels: { nodes: Array<{ name: string }> } | undefined,
): string[] {
  return labels?.nodes?.map((label) => label.name).filter(Boolean) || [];
}

export function safeGetAssignees(
  assignees: { nodes: Array<{ login: string }> } | undefined,
): string[] {
  return (
    assignees?.nodes?.map((assignee) => assignee.login).filter(Boolean) || []
  );
}

// Response types for GraphQL queries
export interface ViewerQueryResponse {
  viewer: {
    login: string;
    name: string | null;
    email: string | null;
    avatarUrl?: string;
  };
}

export interface SingleRepositoryQueryResponse {
  repository: GitHubGraphQLRepository | null;
}

export interface UserRepositoriesQueryResponse {
  user: {
    repositories: {
      nodes: GitHubGraphQLRepository[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

export interface OrganizationRepositoriesQueryResponse {
  organization: {
    repositories: {
      nodes: GitHubGraphQLRepository[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

/**
 * Main query for repository sync - gets everything in one request
 */
export const REPOSITORY_SYNC_QUERY = `
  query RepositorySync($owner: String!, $name: String!, $issuesCursor: String, $prsCursor: String) {
    repository(owner: $owner, name: $name) {
      id
      name
      owner {
        login
      }
      defaultBranch: defaultBranchRef {
        name
      }
      
      # README from default branch
      readme: object(expression: "HEAD:README.md") {
        ... on Blob {
          text
          oid
        }
      }
      
      # Documentation directory
      docs: object(expression: "HEAD:docs") {
        ... on Tree {
          entries {
            name
            type
            object {
              ... on Blob {
                text
                oid
              }
            }
          }
        }
      }
      
      # Issues (excluding PRs)
      issues(
        first: 50
        after: $issuesCursor
        orderBy: { field: UPDATED_AT, direction: DESC }
        filterBy: { states: [OPEN, CLOSED] }
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          number
          title
          body
          state
          author {
            login
          }
          labels(first: 10) {
            nodes {
              name
            }
          }
          assignees(first: 10) {
            nodes {
              login
            }
          }
          createdAt
          updatedAt
          closedAt
          url
          comments {
            totalCount
          }
        }
      }
      
      # Pull Requests
      pullRequests(
        first: 30
        after: $prsCursor
        orderBy: { field: UPDATED_AT, direction: DESC }
        states: [OPEN, CLOSED, MERGED]
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          number
          title
          body
          state
          author {
            login
          }
          labels(first: 10) {
            nodes {
              name
            }
          }
          assignees(first: 10) {
            nodes {
              login
            }
          }
          reviewRequests(first: 10) {
            nodes {
              requestedReviewer {
                ... on User {
                  login
                }
              }
            }
          }
          createdAt
          updatedAt
          closedAt
          mergedAt
          url
          baseRefName
          headRefName
          additions
          deletions
          changedFiles
          
          # Changed files (limited to avoid huge payloads)
          files(first: 20) {
            nodes {
              path
              additions
              deletions
              changeType
            }
          }
          
          # Comments
          comments(first: 5) {
            totalCount
            nodes {
              author {
                login
              }
              body
            }
          }
        }
      }
    }
  }
`;

/**
 * Query for organization repositories
 */
export const ORGANIZATION_REPOSITORIES_QUERY = `
  query OrganizationRepositories($org: String!, $cursor: String) {
    organization(login: $org) {
      repositories(
        first: 100
        after: $cursor
        orderBy: { field: UPDATED_AT, direction: DESC }
        isFork: false
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          name
          owner {
            login
          }
          updatedAt
          isPrivate
          isArchived
        }
      }
    }
  }
`;

/**
 * Query for user repositories
 */
export const USER_REPOSITORIES_QUERY = `
  query UserRepositories($user: String!, $cursor: String) {
    user(login: $user) {
      repositories(
        first: 100
        after: $cursor
        orderBy: { field: UPDATED_AT, direction: DESC }
        isFork: false
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          name
          owner {
            login
          }
          updatedAt
          isPrivate
          isArchived
        }
      }
    }
  }
`;

export const SINGLE_REPOSITORY_QUERY = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      owner {
        login
      }
      name
    }
  }
`;

/**
 * Query for authentication test
 */
export const VIEWER_QUERY = `
  query Viewer {
    viewer {
      login
      name
      email
      avatarUrl
    }
  }
`;
