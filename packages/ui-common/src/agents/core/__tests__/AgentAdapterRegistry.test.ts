import { describe, expect, it } from "vitest";
import {
  AgentAdapterRegistry,
  type AgentAdapter,
  type AgentInitOptions,
  type MessageStream,
  type AgentSessionId,
  type SubmitPromptOptions,
} from "..";

const emptyStream = async function* (): MessageStream {
  return;
};

class MockAdapter implements AgentAdapter {
  readonly name = "mock";

  async init(_options: AgentInitOptions): Promise<void> {}

  async submitPrompt(
    _prompt: string,
    _options?: SubmitPromptOptions
  ): Promise<MessageStream> {
    return emptyStream();
  }

  async resume(
    _sessionId: AgentSessionId,
    _prompt: string,
    _options?: SubmitPromptOptions
  ): Promise<MessageStream> {
    return emptyStream();
  }

  async close(): Promise<void> {}
}

describe("AgentAdapterRegistry", () => {
  it("registers and creates adapters by id", () => {
    const registry = new AgentAdapterRegistry();
    registry.register("mock", () => new MockAdapter());

    expect(registry.has("mock")).toBe(true);
    expect(registry.list()).toEqual(["mock"]);

    const adapter = registry.create("mock");
    expect(adapter.name).toBe("mock");
  });

  it("throws useful errors for unknown adapters", () => {
    const registry = new AgentAdapterRegistry();
    registry.register("mock", () => new MockAdapter());

    expect(() => registry.create("missing")).toThrow(
      "Unknown agent adapter: missing. Available: mock"
    );
  });

  it("allows replacing existing adapter factories", async () => {
    class ReplacedMockAdapter extends MockAdapter {
      override readonly name = "replacement";
    }

    const registry = new AgentAdapterRegistry();
    registry.register("mock", () => new MockAdapter());
    registry.register("mock", () => new ReplacedMockAdapter());

    const adapter = registry.create("mock");
    expect(adapter.name).toBe("replacement");
  });
});
