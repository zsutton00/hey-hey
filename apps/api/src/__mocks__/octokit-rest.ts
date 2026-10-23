export class Octokit {
  constructor(_options?: Record<string, unknown>) {}

  /**
   * Very small stub for the subset of the REST API our unit-tests rely on.
   * Add methods as we grow test coverage.
   */
  public rest = {
    users: {
      getAuthenticated: async () => ({
        data: { login: 'mock-user', type: 'User' },
      }),
    },
    repos: {
      listForOrg: async (_params: unknown) => ({ data: [] as unknown[] }),
      listForUser: async (_params: unknown) => ({ data: [] as unknown[] }),
    },
  } as const;

  /**
   * paginate helper – always resolves to an empty array unless overridden in a specific test.
   */
  public async paginate(
    _method: (...args: unknown[]) => Promise<unknown>,
    _params?: unknown,
  ): Promise<unknown[]> {
    return [];
  }
}
