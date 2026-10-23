/**
 * Owns the listening local server endpoint shared by provider integrations.
 * The application constructs one instance and passes it to the runtime and
 * every consumer, avoiding process-global URL state.
 */
export class LocalAgentEndpoint {
  private baseUrl: string | null = null;

  public set(url: string): void {
    this.baseUrl = url;
  }

  public get(): string | null {
    return this.baseUrl;
  }

  public clear(): void {
    this.baseUrl = null;
  }
}
