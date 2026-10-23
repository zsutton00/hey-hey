import { NodeExecutionService } from '../node-execution.service';
import { FlowTemplate } from 'src/types/flow-internal.types';

/**
 * Characterization test for flow-template resolution.
 *
 * Locks the live-adoption rollout constraint that the plan-from-design-doc
 * rewire and its drain step rest on: templates are resolved from an
 * in-memory registry keyed by flow id ALONE. The `version` field is
 * informational (logged at registration, never consulted in a lookup), and
 * a redeployed graph is adopted live by in-flight executions because
 * Temporal re-resolves node config from current code on every step (see
 * `loadNodeConfiguration` in `src/workflows/phases/initialization.ts`).
 *
 * If a future change makes resolution version-aware, these assertions fail
 * and force the author to confront the documented rollout rule in
 * `docs/conversation-workflows/WORKFLOW-SYSTEM.md` before shipping.
 */
describe('NodeExecutionService - flow template resolution', () => {
  // registerFlow/getFlow are a pure in-memory registry and touch none of the
  // injected dependencies, so all constructor args can be stubbed.
  const makeService = () =>
    new NodeExecutionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  const makeFlow = (id: string, version: number): FlowTemplate =>
    ({
      id,
      version,
      nodes: { start: { transitions: {} } },
    }) as unknown as FlowTemplate;

  it('resolves a registered flow by its flow id from the live registry', () => {
    const service = makeService();
    const flow = makeFlow('plan-from-design-doc', 1);

    service.registerFlow(flow);

    // Same object reference back — a live registry, not a cloned snapshot.
    expect(service.getFlow('plan-from-design-doc')).toBe(flow);
  });

  it('returns undefined for an unregistered flow id', () => {
    const service = makeService();
    service.registerFlow(makeFlow('plan-from-design-doc', 1));

    expect(service.getFlow('some-other-flow')).toBeUndefined();
  });

  it('does not include version in the lookup key — re-registering the same id overwrites', () => {
    const service = makeService();
    const v1 = makeFlow('plan-from-design-doc', 1);
    const v2 = makeFlow('plan-from-design-doc', 2);

    service.registerFlow(v1);
    service.registerFlow(v2);

    // If `version` were part of the key, v1 and v2 would coexist and the
    // lookup would need disambiguation. Instead v2 silently replaces v1 under
    // the bare flow id — this is exactly the live adoption an in-flight
    // execution sees when a new graph version is deployed.
    expect(service.getFlow('plan-from-design-doc')).toBe(v2);
  });

  it('cannot be addressed by a version-qualified key', () => {
    const service = makeService();
    service.registerFlow(makeFlow('plan-from-design-doc', 3));

    // The version is not part of the address space in any form.
    expect(service.getFlow('plan-from-design-doc@3')).toBeUndefined();
    expect(service.getFlow('plan-from-design-doc:3')).toBeUndefined();
  });
});
