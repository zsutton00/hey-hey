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
const LEGACY_DIRECT_PROJECT = 'proj-legacy-direct';
const HALF_DECLARED_OVERRIDE_PROJECT = 'proj-half-declared-override';
const TWO_KIND_OVERRIDE_PROJECT = 'proj-two-kind-override';

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
  acceptance: { type: 'NO_STATUS_CHANGE' },
  allowedNodeTypes: ['BUG'],
  start: { type: 'NO_STATUS_CHANGE' },
  done: { type: 'NORMALIZED_RESULT' },
  supervision: { type: 'DIRECT_ACCEPTANCE' },
};

/** The direct kind with its start policy omitted, for the registry to fill. */
const { acceptance: _legacyAcceptance, ...legacyDirectKind } = directKind;

const { start: _directStart, ...directKindWithoutStart } = directKind;

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
  const { monitorKinds: _canonicalKinds, ...capabilitiesWithoutKinds } =
    globalMonitor.capabilities as Record<string, unknown>;
  const override = (projectId: string, monitorKinds?: unknown[]) =>
    ({
      ...globalMonitor,
      id: `override-${projectId}`,
      isSystem: false,
      projectId,
      capabilities:
        monitorKinds === undefined
          ? capabilitiesWithoutKinds
          : { ...capabilitiesWithoutKinds, monitorKinds },
    }) as unknown as WorkItemType;
  const projectRows = [
    override(NO_KIND_OVERRIDE_PROJECT),
    override(PRE_POLICY_OVERRIDE_PROJECT, [prePolicyKind]),
    override(DIRECT_OVERRIDE_PROJECT, [directKind]),
    override(LEGACY_DIRECT_PROJECT, [legacyDirectKind]),
    override(HALF_DECLARED_OVERRIDE_PROJECT, [halfDeclaredKind]),
    override(TWO_KIND_OVERRIDE_PROJECT, [
      prePolicyKind,
      directKindWithoutStart,
    ]),
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
            LEGACY_DIRECT_PROJECT,
            HALF_DECLARED_OVERRIDE_PROJECT,
            TWO_KIND_OVERRIDE_PROJECT,
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

/** The effective kinds the project's TASK_MONITOR type declares. */
function effectiveKinds(
  registry: WorkItemTypeRegistryService,
  projectId: string,
) {
  return effective(registry, projectId)?.definition.capabilities?.monitorKinds;
}

/** The project's single effective kind, for projects that declare one. */
function onlyKind(registry: WorkItemTypeRegistryService, projectId: string) {
  const kinds = effectiveKinds(registry, projectId);
  expect(kinds).toHaveLength(1);
  return kinds![0]!;
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
    expect(canonical?.definition.capabilities?.monitorKinds).toEqual([
      {
        key: 'task',
        acceptance: { type: 'COMPLETE_ITEM' },
        allowedNodeTypes: ['STANDARD'],
        allowedLaunchMethods: ['plan', 'open', 'quick'],
        allowedRuntimeProviders: shipped['allowedRuntimeProviders'],
        allowedReasoningEfforts: shipped['allowedReasoningEfforts'],
        start: { type: 'STATUS_TRANSITION', status: 'ACTIVE' },
        done: { type: 'ITEM_STATUS', status: 'COMPLETED' },
        supervision: { type: 'COORDINATOR_REVIEW' },
      },
    ]);
    expect(
      monitorKindPolicyIssues(onlyKind(registry, CANONICAL_PROJECT)),
    ).toEqual([]);
  });

  it('resolves an override that predates kinds to the canonical Task kind', async () => {
    const registry = await registryWithMonitorOverrides();
    const override = effective(registry, NO_KIND_OVERRIDE_PROJECT);

    expect(override?.effectiveSource).toBe(
      WorkItemTypeEffectiveSource.CanonicalOverride,
    );
    expect(override?.definition.capabilities?.monitorKinds).toEqual(
      effectiveKinds(registry, CANONICAL_PROJECT),
    );
    expect(override?.definition.capabilities?.requiresParent).toBe(true);
  });

  it('keeps an override kind that predates policies and fills only its omitted policies', async () => {
    const registry = await registryWithMonitorOverrides();

    expect(onlyKind(registry, PRE_POLICY_OVERRIDE_PROJECT)).toEqual({
      ...prePolicyKind,
      start: shipped['start'],
      done: shipped['done'],
      supervision: shipped['supervision'],
      acceptance: shipped['acceptance'],
    });
  });

  it('completes legacy normalized-result overrides centrally without changing explicit policies', async () => {
    const registry = await registryWithMonitorOverrides();
    const kind = onlyKind(registry, LEGACY_DIRECT_PROJECT);
    expect(kind).toEqual(directKind);
    expect(monitorKindPolicyIssues(kind)).toEqual([]);
  });

  it('honors a complete non-Task configuration exactly as declared', async () => {
    const registry = await registryWithMonitorOverrides();
    const kind = onlyKind(registry, DIRECT_OVERRIDE_PROJECT);

    expect(kind).toEqual(directKind);
    expect(monitorKindPolicyIssues(kind)).toEqual([]);
  });

  it('reports a declared policy that cannot pair with an inherited one, without blocking other projects', async () => {
    const registry = await registryWithMonitorOverrides();
    const kind = onlyKind(registry, HALF_DECLARED_OVERRIDE_PROJECT);

    expect(kind.done).toEqual(shipped['done']);
    expect(monitorKindPolicyIssues(kind)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DIRECT_ACCEPTANCE requires NORMALIZED_RESULT'),
      ]),
    );
    expect(
      monitorKindPolicyIssues(onlyKind(registry, CANONICAL_PROJECT)),
    ).toEqual([]);
  });

  it('fills omitted policies separately for each declared kind from the canonical Task kind', async () => {
    const registry = await registryWithMonitorOverrides();
    const kinds = effectiveKinds(registry, TWO_KIND_OVERRIDE_PROJECT);

    expect(kinds).toEqual([
      {
        ...prePolicyKind,
        start: shipped['start'],
        done: shipped['done'],
        supervision: shipped['supervision'],
        acceptance: shipped['acceptance'],
      },
      { ...directKind, start: shipped['start'] },
    ]);
    expect(monitorKindPolicyIssues(kinds![0]!)).toEqual([]);
    expect(monitorKindPolicyIssues(kinds![1]!)).toEqual([
      expect.stringContaining('NO_STATUS_CHANGE start'),
    ]);
  });
});
