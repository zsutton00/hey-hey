import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { WorkItemType } from '@prisma/client';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { buildBuiltInWorkItemTypeRows } from '../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { workItemTypeCapabilitiesSchema } from '../work-item-type-capabilities.schema';
import {
  resolveTaskMonitorKind,
  TASK_MONITOR_TASK_KIND,
} from '../task-monitor-kind';

const CANONICAL_PROJECT = 'proj-canonical';
const LEGACY_OVERRIDE_PROJECT = 'proj-legacy-override';
const NARROWED_OVERRIDE_PROJECT = 'proj-narrowed-override';

const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../../../../db/flyway/V2026.11.13.064226__publish_task_monitor_task_kind.sql',
  ),
  'utf8',
);

const shippedKind = (() => {
  const literal = /\$kind\$([\s\S]*?)\$kind\$/.exec(migrationSql)?.[1];
  return workItemTypeCapabilitiesSchema.parse({
    monitorKind: JSON.parse(literal ?? 'null'),
  }).monitorKind;
})();

const narrowedKind = {
  ...TASK_MONITOR_TASK_KIND,
  key: 'narrowed',
  allowedLaunchMethods: ['quick' as const],
};

async function registryWithMonitorKind() {
  const globalRows = buildBuiltInWorkItemTypeRows().map((row) =>
    row.typeKey === 'TASK_MONITOR'
      ? ({
          ...row,
          capabilities: {
            ...(row.capabilities as object),
            monitorKind: shippedKind,
          },
        } as unknown as WorkItemType)
      : row,
  );
  const globalMonitor = globalRows.find(
    (row) => row.typeKey === 'TASK_MONITOR',
  )!;
  const override = (projectId: string, monitorKind?: unknown) =>
    ({
      ...globalMonitor,
      id: `override-${projectId}`,
      isSystem: false,
      projectId,
      capabilities: {
        ...(globalMonitor.capabilities as Record<string, unknown>),
        monitorKind,
      },
    }) as unknown as WorkItemType;
  const projectRows = [
    override(LEGACY_OVERRIDE_PROJECT),
    override(NARROWED_OVERRIDE_PROJECT, narrowedKind),
  ];
  const prisma = {
    project: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          [
            CANONICAL_PROJECT,
            LEGACY_OVERRIDE_PROJECT,
            NARROWED_OVERRIDE_PROJECT,
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

const declaredKind = (
  registry: WorkItemTypeRegistryService,
  projectId: string,
) =>
  resolveTaskMonitorKind(
    registry.getDefinition(projectId, 'TASK_MONITOR')?.definition.capabilities
      ?.monitorKind,
  );

describe('effective monitor kind for the TASK_MONITOR type', () => {
  it('resolves the shipped Task kind for a project on the canonical definition', async () => {
    const registry = await registryWithMonitorKind();

    expect(declaredKind(registry, CANONICAL_PROJECT)).toEqual(
      TASK_MONITOR_TASK_KIND,
    );
  });

  it('falls back to the Task kind for a project override that predates kinds', async () => {
    const registry = await registryWithMonitorKind();

    expect(
      registry.getDefinition(LEGACY_OVERRIDE_PROJECT, 'TASK_MONITOR')
        ?.definition.capabilities?.monitorKind,
    ).toBeUndefined();
    expect(declaredKind(registry, LEGACY_OVERRIDE_PROJECT)).toEqual(
      TASK_MONITOR_TASK_KIND,
    );
  });

  it('honors the kind a project override declares', async () => {
    const registry = await registryWithMonitorKind();

    expect(declaredKind(registry, NARROWED_OVERRIDE_PROJECT)).toEqual(
      narrowedKind,
    );
  });
});
