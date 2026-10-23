import type { OAuthClient } from '../../auth/oauth-client';

/** Resolves a fresh platform bearer token for submission-tool owners. */
export class SubmissionToolAuth {
  public constructor(private readonly oauthClient: OAuthClient) {}

  public async getAccessToken(): Promise<string> {
    const result = await this.oauthClient.getAccessToken({});
    if (!result.success) {
      throw new Error(`Authentication failed: ${result.error}`);
    }
    return result.data;
  }
}
