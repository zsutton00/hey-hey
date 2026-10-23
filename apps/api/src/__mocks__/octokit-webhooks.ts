export class Webhooks {
  constructor(_options?: Record<string, unknown>) {}

  /**
   * Mock webhook handler for testing
   */
  public on(
    _eventName: string,
    _handler: (payload: { id: string; name: string; payload: object }) => void,
  ) {
    // Mock implementation - just store the handler for testing
    return this;
  }

  public async verifyAndReceive(_options: {
    id: string;
    name: string;
    signature: string;
    payload: string;
  }) {
    // Mock implementation - return success
    return Promise.resolve();
  }

  public async receive(_options: {
    id: string;
    name: string;
    payload: object;
  }) {
    // Mock implementation - return success
    return Promise.resolve();
  }
}
