import type { PlatformMcpForwarder } from './forwarder';
import type { JsonRpcRequest, PlatformMcpProxyResult } from './session';

/**
 * A scoped platform MCP proxy owned by a child agent rather than by the Run's
 * active Turn. Children run beside their parent's Turn, so they are found by
 * their own mount identity.
 */
export interface ChildPlatformMcpProxy {
  readonly runId: string;
  matches(input: { turnId: string; token: string }): boolean;
  handleJsonRpc(
    request: JsonRpcRequest,
    forwarder: PlatformMcpForwarder,
  ): Promise<PlatformMcpProxyResult>;
}

export class ChildPlatformMcpProxyRegistry {
  private readonly proxies = new Set<ChildPlatformMcpProxy>();

  /** Registers a proxy for the child's lifetime; call the returned function when it ends. */
  public register(proxy: ChildPlatformMcpProxy): () => void {
    this.proxies.add(proxy);
    return () => {
      this.proxies.delete(proxy);
    };
  }

  public find(input: {
    runId: string;
    turnId: string;
    token: string;
  }): ChildPlatformMcpProxy | null {
    for (const proxy of this.proxies) {
      if (proxy.runId === input.runId && proxy.matches(input)) return proxy;
    }
    return null;
  }
}

/** Process-wide: the local MCP endpoint and the child launcher share it. */
export const childPlatformMcpProxies = new ChildPlatformMcpProxyRegistry();
