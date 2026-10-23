export const graphql = {
  defaults: (_options: { auth: string }) => {
    return async (
      query: string,
      _variables?: Record<string, string | number | boolean>,
    ) => {
      // Mock GraphQL responses
      if (query.includes('viewer')) {
        return {
          viewer: {
            login: 'test-user',
            name: 'Test User',
            email: 'test@example.com',
          },
        };
      }

      if (query.includes('organization')) {
        return {
          organization: {
            repositories: {
              totalCount: 0,
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
              nodes: [],
            },
          },
        };
      }

      if (query.includes('user')) {
        return {
          user: {
            repositories: {
              totalCount: 0,
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
              nodes: [],
            },
          },
        };
      }

      if (query.includes('repository')) {
        return {
          repository: {
            id: 'mock-repo-id',
            name: 'mock-repo',
            owner: {
              login: 'mock-owner',
            },
            defaultBranch: {
              name: 'main',
            },
            readme: null,
            docs: null,
            issues: {
              totalCount: 0,
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
              nodes: [],
            },
            pullRequests: {
              totalCount: 0,
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
              nodes: [],
            },
          },
        };
      }

      return {};
    };
  },
};
