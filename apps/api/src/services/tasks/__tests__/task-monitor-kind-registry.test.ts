import type { WorkItemType } from '@prisma/client';
import { WorkItemTypeEffectiveSource } from '@hey-hey/contracts/api/models';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { buildBuiltInWorkItemTypeRows } from '../../../../test/setup/work-item-type-registry.fixture';
import { shippedTaskMonitorKind } from '../../../../test/setup/shipped-task-monitor-kind';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { monitorKindPolicyIssues } from '../task-monitor-kind';

const CANONICAL_PROJECT = 'proj-canonical';
const NO_KIND_OVERRIDE_PROJECT = 'proj-no-kind-override';
const PRE_POLICY_OVERRIDE_PROJECT = 'proj-pre-policy-override';
const DIRECT_OVERRIDE_PROJECT = 'proj-direct-override';
const HALF_DECLARED_OVERRIDE_PROJECT = 'proj-half-declared-override';

const shipped = shippedTaskMonitorKind();

/** The kind an override saved before policies existed: restrictions only, narrowed. */
const prePolicyKind = {
  key: 'narrowed',
  allowedNodeTypes: ['STANDARD'],
  allowedLaunchMethods: ['quick'],
  allowedRuntimeProviders: ['codex'],
  allowedReasoningEfforts: ['high'],
};

/** A complete, deliberately non-Task configuration. */
const directKind = {
  ...prePolicyKind,
  key: 'requirement-check',
  allowedNodeTypes: ['BUG'],
  start: { type: 'NO_STATUS_CHANGE' },
  done: { type: 'NORMALIZED_RESULT' },
  supervision: { type: 'DIRECT_ACCEPTANCE' },
};

/** Declares direct acceptance but omits done, so canonical item-status done would pair with it. */
const halfDeclaredKind = {
  ...prePolicyKind,
  key: 'half-declared',
  supervision: { type: 'DIRECT_ACCEPTANCE' },
};

async function registryWithMonitorOverrides() {
  const globalRows = buildBuiltInWorkItemTypeRows();
  const globalMonitor = globalRows.find(
    (row) => row.typeKey === 'TASK_MONITOR',
  )!;
  const { monitorKind: _canonicalKind, ...capabilitiesWithoutKind } =
    globalMonitor.capabilities as Record<string, unknown>;
  const override = (projectId: string, monitorKind?: unknown) =>
    ({
      ...globalMonitor,
      id: `override-${projectId}`,
      isSystem: false,
      projectId,
      capabilities:
        monitorKind === undefined
          ? capabilitiesWithoutKind
          : { ...capabilitiesWithoutKind, monitorKind },
    }) as unknown as WorkItemType;
  const projectRows = [
    override(NO_KIND_OVERRIDE_PROJECT),
    override(PRE_POLICY_OVERRIDE_PROJECT, prePolicyKind),
    override(DIRECT_OVERRIDE_PROJECT, directKind),
    override(HALF_DECLARED_OVERRIDE_PROJECT, halfDeclaredKind),
  ];
  const prisma = {
    project: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          [
            CANONICAL_PROJECT,
            NO_KIND_OVERRIDE_PROJECT,
            PRE_POLICY_OVERRIDE_PROJECT,
            DIRECT_OVERRIDE_PROJECT,
            HALF_DECLARED_OVERRIDE_PROJECT,
          ].map((id) => ({ id })),
        ),
    },
    workItemType: { findMany: jest.fn().mockResolvedValue(projectRows) },
    workItemTypeTemplate: { findMany: jest.fn().mockResolvedValue(globalRows) },
  } as unknown as PrismaService;
  const registry = new WorkItemTypeRegistryService(
    prisma,
    new InMemoryMessageBus(),
  );
  await registry.refresh();
  return registry;
}

function effective(registry: WorkItemTypeRegistryService, projectId: string) {
  const detail = registry.getDefinition(projectId, 'TASK_MONITOR');
  const listed = registry
    .getDefinitions(projectId)
    .find((summary) => summary.definition.key === 'TASK_MONITOR');
  expect(listed).toEqual(detail);
  return detail;
}

describe('effective monitor kind for the TASK_MONITOR type', () => {
  it('publishes the Task kind and its policies on the canonical definition', async () => {
    const registry = await registryWithMonitorOverrides();
    const canonical = effective(registry, CANONICAL_PROJECT);

    expect(canonical?.effectiveSource).toBe(
      WorkItemTypeEffectiveSource.Canonical,
    );
    expect(canonical?.definition.capabilities?.monitorKind).toEqual({
      key: 'task',
      allowedNodeTypes: ['STANDARD'],
      allowedLaunchMethods: ['plan', 'open', 'quick'],
      allowedRuntimeProviders: shipped['allowedRuntimeProviders'],
      allowedReasoningEfforts: shipped['allowedReasoningEfforts'],
      start: { type: 'STATUS_TRANSITION', status: 'ACTIVE' },
      done: { type: 'ITEM_STATUS', status: 'COMPLETED' },
      supervision: { type: 'COORDINATOR_REVIEW' },
    });
    expect(
      monitorKindPolicyIssues(canonical?.definition.capabilities?.monitorKind),
    ).toEqual([]);
  });

  it('resolves an override that predates kinds to the canonical Task kind', async () => {
    const registry = await registryWithMonitorOverrides();
    const override = effective(registry, NO_KIND_OVERRIDE_PROJECT);

    expect(override?.effectiveSource).toBe(
      WorkItemTypeEffectiveSource.CanonicalOverride,
    );
    expect(override?.definition.capabilities?.monitorKind).toEqual(
      effective(registry, CANONICAL_PROJECT)?.definition.capabilities
        ?.monitorKind,
    );
    expect(override?.definition.capabilities?.requiresParent).toBe(true);
  });

  it('keeps an override kind that predates policies and fills only its omitted policies', async () => {
    const registry = await registryWithMonitorOverrides();

    expect(
      effective(registry, PRE_POLICY_OVERRIDE_PROJECT)?.definition.capabilities
        ?.monitorKind,
    ).toEqual({
      ...prePolicyKind,
      start: shipped['start'],
      done: shipped['done'],
      supervision: shipped['supervision'],
    });
  });

  it('honors a complete non-Task configuration exactly as declared', async () => {
    const registry = await registryWithMonitorOverrides();
    const kind = effective(registry, DIRECT_OVERRIDE_PROJECT)?.definition
      .capabilities?.monitorKind;

    expect(kind).toEqual(directKind);
    expect(monitorKindPolicyIssues(kind)).toEqual([]);
  });

  it('reports a declared policy that cannot pair with an inherited one, without blocking other projects', async () => {
    const registry = await registryWithMonitorOverrides();
    const kind = effective(registry, HALF_DECLARED_OVERRIDE_PROJECT)?.definition
      .capabilities?.monitorKind;

    expect(kind?.done).toEqual(shipped['done']);
    expect(monitorKindPolicyIssues(kind)).toEqual([
      '"half-declared" monitor kind combines supervision "DIRECT_ACCEPTANCE" with done "ITEM_STATUS"; supervision "DIRECT_ACCEPTANCE" requires done "NORMALIZED_RESULT"',
    ]);
    expect(
      monitorKindPolicyIssues(
        effective(registry, CANONICAL_PROJECT)?.definition.capabilities
          ?.monitorKind,
      ),
    ).toEqual([]);
  });
});
