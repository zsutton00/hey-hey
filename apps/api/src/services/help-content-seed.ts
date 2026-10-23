import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  HelpContentChangedEvent,
  HelpContentChangedEventPayload,
  HelpDemo,
  HelpDemoDsl,
  HelpDemoPreset,
  HelpNodeWithBody,
} from 'src/generated';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import { canonicalizeJcs } from '../core/websockets/trigger-canonicalization';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxStore } from './outbox-store.service';
import {
  DEFAULT_HELP_CONTENT_DIRECTORY,
  HelpSourceDemo,
  HelpSourceNode,
  loadHelpContentSource,
  validateHelpContentSource,
} from './help-content-source';

export interface HelpContentSeedSummary {
  nodes: { created: number; updated: number; unchanged: number };
  demos: {
    created: number;
    updated: number;
    deleted: number;
    unchanged: number;
  };
  changedNodeIds: string[];
  drift: Array<{ id: string; slugPath: string }>;
}

export interface SeedHelpContentOptions {
  sourceDirectory?: string;
  sourceNodes?: readonly HelpSourceNode[];
  eventPublisher?: Pick<DomainEventPublisher, 'publishInTransaction'>;
}

type ExistingHelpNode = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  body: string;
  ordering: number;
};
type ExistingHelpDemo = {
  id: string;
  helpNodeId: string;
  ordering: number;
  caption: string;
  kind: string;
  presetKey: string | null;
  definition: Prisma.JsonValue | null;
};

const HELP_CONTENT_LOCK_KEY = 'help-content-source-reconciliation-v1';

export async function seedHelpContent(
  prisma: PrismaClient,
  options: SeedHelpContentOptions = {},
): Promise<HelpContentSeedSummary> {
  const sourceNodes = options.sourceNodes
    ? [...options.sourceNodes]
    : await loadHelpContentSource(
        options.sourceDirectory ?? DEFAULT_HELP_CONTENT_DIRECTORY,
      );
  validateHelpContentSource(sourceNodes);

  const eventPublisher =
    options.eventPublisher ??
    new DomainEventPublisher(
      new OutboxStore(prisma as unknown as PrismaService),
    );

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${HELP_CONTENT_LOCK_KEY}, 0))::text AS "lockAcquired"`,
    );

    const summary = createEmptySummary();
    const changedNodeIds = new Set<string>();
    const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
    const existingNodes = await tx.helpNode.findMany({
      select: {
        id: true,
        parentId: true,
        slug: true,
        title: true,
        body: true,
        ordering: true,
      },
    });
    const existingById = new Map(existingNodes.map((node) => [node.id, node]));

    for (const source of topologicallySort(sourceNodes)) {
      const current = existingById.get(source.id);
      if (!current) {
        const legacy = existingNodes.find(
          (node) =>
            node.parentId === source.parentId && node.slug === source.slug,
        );
        if (legacy) {
          if (sourceById.has(legacy.id)) {
            throw new Error(
              `Cannot adopt Help node ${legacy.id} as ${source.id}: its id belongs to another source node`,
            );
          }
          const legacyId = legacy.id;
          await tx.helpNode.update({
            where: { id: legacyId },
            data: nodeWriteData(source),
          });
          legacy.id = source.id;
          legacy.parentId = source.parentId;
          legacy.slug = source.slug;
          legacy.title = source.title;
          legacy.body = source.body;
          legacy.ordering = source.ordering;
          for (const candidate of existingNodes) {
            if (candidate.parentId === legacyId) candidate.parentId = source.id;
          }
          existingById.delete(legacyId);
          existingById.set(source.id, legacy);
          summary.nodes.updated += 1;
        } else {
          await tx.helpNode.create({ data: nodeWriteData(source) });
          summary.nodes.created += 1;
          const created = nodeWriteData(source);
          existingNodes.push(created);
          existingById.set(source.id, created);
        }
        changedNodeIds.add(source.id);
      } else if (nodeMatches(current, source)) {
        summary.nodes.unchanged += 1;
      } else {
        await tx.helpNode.update({
          where: { id: source.id },
          data: nodeWriteData(source),
        });
        Object.assign(current, nodeWriteData(source));
        summary.nodes.updated += 1;
        changedNodeIds.add(source.id);
      }
    }

    const sourceNodeIds = sourceNodes.map((node) => node.id);
    const existingDemos = await tx.helpDemo.findMany({
      where: { helpNodeId: { in: sourceNodeIds } },
      select: {
        id: true,
        helpNodeId: true,
        ordering: true,
        caption: true,
        kind: true,
        presetKey: true,
        definition: true,
      },
    });
    const demosById = new Map(existingDemos.map((demo) => [demo.id, demo]));
    const sourceDemoIds = new Set<string>();

    for (const node of sourceNodes) {
      for (const demo of node.demos) {
        sourceDemoIds.add(demo.id);
        const current = demosById.get(demo.id);
        if (!current) {
          await tx.helpDemo.create({ data: demoWriteData(node.id, demo) });
          summary.demos.created += 1;
          changedNodeIds.add(node.id);
        } else if (demoMatches(current, node.id, demo)) {
          summary.demos.unchanged += 1;
        } else {
          await tx.helpDemo.update({
            where: { id: demo.id },
            data: demoWriteData(node.id, demo),
          });
          summary.demos.updated += 1;
          changedNodeIds.add(node.id);
          changedNodeIds.add(current.helpNodeId);
        }
      }
    }

    for (const demo of existingDemos) {
      if (!sourceDemoIds.has(demo.id)) {
        await tx.helpDemo.delete({ where: { id: demo.id } });
        summary.demos.deleted += 1;
        changedNodeIds.add(demo.helpNodeId);
      }
    }

    const drift = buildDrift(existingNodes, sourceById);
    const publishableIds = [...changedNodeIds]
      .filter((id) => sourceById.has(id))
      .sort();
    const snapshots =
      publishableIds.length === 0
        ? []
        : await tx.helpNode.findMany({
            where: { id: { in: publishableIds } },
            include: { demos: { orderBy: { ordering: 'asc' } } },
          });
    const snapshotById = new Map(
      snapshots.map((row) => [row.id, toHelpNodeWithBody(row)]),
    );

    for (const id of publishableIds) {
      const helpNode = snapshotById.get(id);
      if (!helpNode) {
        throw new Error(
          `Changed Help node ${id} is missing after reconciliation`,
        );
      }
      const payload = {
        payloadType:
          HelpContentChangedEventPayload.PayloadTypeEnum.HelpContentChanged,
        helpNode,
        contentHash: hashHelpNode(helpNode),
      } satisfies HelpContentChangedEventPayload;
      await eventPublisher.publishInTransaction(tx, {
        type: HelpContentChangedEvent.TypeEnum.HelpContentChanged,
        aggregateId: id,
        payload,
      });
    }

    summary.changedNodeIds = publishableIds;
    summary.drift = drift;
    return summary;
  });
}

function createEmptySummary(): HelpContentSeedSummary {
  return {
    nodes: { created: 0, updated: 0, unchanged: 0 },
    demos: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
    changedNodeIds: [],
    drift: [],
  };
}

function topologicallySort(nodes: readonly HelpSourceNode[]): HelpSourceNode[] {
  const pending = new Map(nodes.map((node) => [node.id, node]));
  const sorted: HelpSourceNode[] = [];
  const resolved = new Set<string>();
  while (pending.size > 0) {
    const next = [...pending.values()].find(
      (node) => node.parentId === null || resolved.has(node.parentId),
    );
    if (!next) throw new Error('Help content contains a cycle');
    sorted.push(next);
    resolved.add(next.id);
    pending.delete(next.id);
  }
  return sorted;
}

function nodeWriteData(source: HelpSourceNode) {
  return {
    id: source.id,
    parentId: source.parentId,
    slug: source.slug,
    title: source.title,
    body: source.body,
    ordering: source.ordering,
  };
}

function nodeMatches(
  existing: ExistingHelpNode,
  source: HelpSourceNode,
): boolean {
  return (
    existing.parentId === source.parentId &&
    existing.slug === source.slug &&
    existing.title === source.title &&
    existing.body === source.body &&
    existing.ordering === source.ordering
  );
}

function demoWriteData(helpNodeId: string, demo: HelpSourceDemo) {
  return demo.kind === 'preset'
    ? {
        id: demo.id,
        helpNodeId,
        ordering: demo.ordering,
        caption: demo.caption,
        kind: demo.kind,
        presetKey: demo.presetKey,
        definition: Prisma.DbNull,
      }
    : {
        id: demo.id,
        helpNodeId,
        ordering: demo.ordering,
        caption: demo.caption,
        kind: demo.kind,
        presetKey: null,
        definition: demo.definition as Prisma.InputJsonObject,
      };
}

function demoMatches(
  existing: ExistingHelpDemo,
  helpNodeId: string,
  source: HelpSourceDemo,
): boolean {
  return (
    existing.helpNodeId === helpNodeId &&
    existing.ordering === source.ordering &&
    existing.caption === source.caption &&
    existing.kind === source.kind &&
    (source.kind === 'preset'
      ? existing.presetKey === source.presetKey && existing.definition === null
      : existing.presetKey === null &&
        canonicalizeJcs(existing.definition) ===
          canonicalizeJcs(source.definition))
  );
}

function buildDrift(
  existingNodes: readonly ExistingHelpNode[],
  sourceById: ReadonlyMap<string, HelpSourceNode>,
): Array<{ id: string; slugPath: string }> {
  const existingById = new Map(existingNodes.map((node) => [node.id, node]));
  return existingNodes
    .filter((node) => !sourceById.has(node.id))
    .map((node) => ({ id: node.id, slugPath: slugPath(node, existingById) }))
    .sort(
      (a, b) =>
        a.slugPath.localeCompare(b.slugPath) || a.id.localeCompare(b.id),
    );
}

function slugPath(
  node: ExistingHelpNode,
  nodesById: ReadonlyMap<string, ExistingHelpNode>,
): string {
  const segments = [node.slug];
  const visited = new Set([node.id]);
  let parentId = node.parentId;
  while (parentId !== null) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) break;
    segments.unshift(parent.slug);
    parentId = parent.parentId;
  }
  return segments.join('/');
}

type HelpNodeWithDemosRow = Prisma.HelpNodeGetPayload<{
  include: { demos: true };
}>;

function toHelpNodeWithBody(row: HelpNodeWithDemosRow): HelpNodeWithBody {
  return {
    id: row.id,
    parentId: row.parentId,
    slug: row.slug,
    title: row.title,
    ordering: row.ordering,
    body: row.body,
    demos: row.demos.map(toHelpDemo),
  } satisfies HelpNodeWithBody;
}

function toHelpDemo(row: ExistingHelpDemo): HelpDemo {
  if (row.kind === 'preset' && row.presetKey) {
    return {
      id: row.id,
      ordering: row.ordering,
      caption: row.caption,
      kind: HelpDemoPreset.KindEnum.Preset,
      presetKey: row.presetKey,
    } satisfies HelpDemoPreset;
  }
  if (
    row.kind === 'dsl' &&
    typeof row.definition === 'object' &&
    row.definition !== null &&
    !Array.isArray(row.definition)
  ) {
    return {
      id: row.id,
      ordering: row.ordering,
      caption: row.caption,
      kind: HelpDemoDsl.KindEnum.Dsl,
      definition: row.definition,
    } satisfies HelpDemoDsl;
  }
  throw new Error(`Invalid persisted Help demo ${row.id}`);
}

export function hashHelpNode(node: HelpNodeWithBody): string {
  return createHash('sha256').update(canonicalizeJcs(node)).digest('hex');
}
