import {
  WithEventContext,
  EventContextManager,
} from '../core/events/observable-event.context';

class ServiceA {
  public captured: any[] = [];

  @WithEventContext('ServiceA', 'root')
  async root() {
    // capture current context
    this.captured.push(EventContextManager.getInstance().getCurrentContext());
    const svcB = new ServiceB(this.captured);
    await svcB.child();
  }
}

class ServiceB {
  constructor(private captured: any[]) {}

  @WithEventContext('ServiceB', 'child')
  async child() {
    this.captured.push(EventContextManager.getInstance().getCurrentContext());
  }
}

describe('EventContext correlation / causation chain', () => {
  it('preserves correlationId and sets causationId when nested', async () => {
    const ctxMgr = EventContextManager.getInstance();
    const rootCtx = ctxMgr.createInitialContext('TestHarness', 'test');

    const svcA = new ServiceA();

    await ctxMgr.runWithContext(rootCtx, async () => {
      await svcA.root();
    });

    const [rootCaptured, childCaptured] = svcA.captured;

    expect(rootCaptured).toBeDefined();
    expect(childCaptured).toBeDefined();

    // Correlation id should be identical
    expect(childCaptured.correlationId).toBe(rootCaptured.correlationId);

    // Causation id of child should match parent correlation or causation id
    expect(childCaptured.causationId).toBe(rootCaptured.correlationId);
  });
});
