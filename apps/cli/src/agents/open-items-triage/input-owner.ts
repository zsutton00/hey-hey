import { z } from 'zod';
import {
  SessionEvidenceReader,
  SESSION_EVIDENCE_CAP,
  selectSessionCandidates,
  type SessionObservation,
} from './session-evidence';
import { extractUserIdFromToken } from '../../auth';
import type { CanonicalJsonValue } from '../../shared/canonical-json';
import type { LocalOpenItemsTriageItem } from '../../shared/agent-bridge-contract/generated';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  attentionSessionSchema,
  DAY_MS,
  isOpenItemCandidate,
  itemKey,
  reduceAttention,
  TRIAGE_CAPS,
  type AttentionCounters,
  type AttentionSession,
} from './attention';
import {
  attentionPageSchema,
  collectionSchema,
  contextSchema,
  envelopeSchema,
  goalDetailSchema,
  goalSchema,
  goalsSchema,
  groupSchema,
  hierarchySchema,
  openItemSchema,
  relatedSchema,
  sourceProposalSchema,
  sourceConversationSchema,
  trackedSchema,
} from './input-schemas';
import { reduceConnections, type Connection } from './relationships';
import type { TriageInputDiagnostics } from './input-diagnostics';

export interface EvidenceLimit {
  scope: string;
  truncated: boolean;
  unavailable: boolean;
  invalidRecords: number;
}
interface GoalInput {
  id: string;
  name: string;
  dueDate: string | null;
  trackedItems: (LocalOpenItemsTriageItem & Pick<z.infer<typeof trackedSchema>, 'status'>)[];
}
const NOTE_MAX_CHARS = 200;
export const TRIAGE_INPUT_BUDGET_BYTES = 150 * 1024;
const inputBytes = (input: unknown) => Buffer.byteLength(JSON.stringify(input), 'utf8');
interface OpenItemRecord extends AttentionCounters {
  key: string;
  title: string;
  group: string | null;
  pinned: boolean;
  note: string | null;
}
const openItemRecord = (
  item: z.infer<typeof openItemSchema>,
  counters: AttentionCounters,
): OpenItemRecord => ({
  key: itemKey(item),
  title: item.presentation.label,
  group: item.groupId,
  pinned: item.pinned,
  note: item.note?.slice(0, NOTE_MAX_CHARS) ?? null,
  ...counters,
});

export class TriageInputOwner {
  private readonly limits: EvidenceLimit[] = [];
  private readonly archivedKeys = new Set<string>();
  private readonly base: string;
  private readonly sessionEvidence: SessionEvidenceReader;
  constructor(
    private readonly deps: PromptTypeHandlerDeps,
    organizationId: string,
    private readonly projectId: string,
    private readonly accessToken: string,
    private readonly now: number,
    private readonly diagnostics?: TriageInputDiagnostics,
  ) {
    this.base = `${deps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`;
    this.sessionEvidence = new SessionEvidenceReader(deps, this.base, accessToken, projectId);
  }

  private async read(url: string): Promise<CanonicalJsonValue> {
    this.deps.logger.debug('open_items_triage.read.started', { path: new URL(url).pathname });
    const response = await this.deps.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) {
      this.diagnostics?.record(url, response.status);
      this.deps.logger.debug('open_items_triage.read.http_failed', {
        path: new URL(url).pathname,
        status: response.status,
      });
      throw new Error(`Read failed (${response.status}).`);
    }
    const data = envelopeSchema.parse(await response.json()).data;
    this.diagnostics?.record(url, response.status, data);
    this.deps.logger.debug('open_items_triage.read.completed', { path: new URL(url).pathname });
    return data;
  }

  private limit(scope: string): EvidenceLimit {
    const limit = { scope, truncated: false, unavailable: false, invalidRecords: 0 };
    this.limits.push(limit);
    return limit;
  }

  private members<T>(
    records: readonly CanonicalJsonValue[],
    schema: z.ZodType<T>,
    cap: number,
    limit: EvidenceLimit,
  ): T[] {
    limit.truncated ||= records.length > cap;
    const reasons: Record<string, number> = {};
    const members = records.slice(0, cap).flatMap((record) => {
      const parsed = schema.safeParse(record);
      if (parsed.success) return [parsed.data];
      limit.invalidRecords++;
      for (const issue of parsed.error.issues) {
        const reason = `${issue.path.join('.') || '(record)'}: ${issue.code}`;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      return [];
    });
    if (Object.keys(reasons).length > 0)
      this.deps.logger.warn('open_items_triage.record.invalid', { scope: limit.scope, reasons });
    return members;
  }

  private failed(limit: EvidenceLimit): void {
    limit.unavailable = true;
    this.deps.logger.warn('open_items_triage.read.unavailable', { scope: limit.scope });
  }

  private async attention(): Promise<{ sessions: AttentionSession[]; complete: boolean }> {
    const limit = this.limit('attention');
    const sessions: AttentionSession[] = [];
    const ids = new Set<string>();
    try {
      for (let page = 0; page < TRIAGE_CAPS.attentionPages; page++) {
        const offset = page * TRIAGE_CAPS.pageSize;
        const query = new URLSearchParams({
          limit: String(TRIAGE_CAPS.pageSize),
          offset: String(offset),
          sort: 'mostRecent',
          includeEntity: 'false',
          since: new Date(this.now - 7 * DAY_MS).toISOString(),
          projectId: this.projectId,
        });
        const result = attentionPageSchema.parse(
          await this.read(`${this.deps.apiBaseUrl}/analytics/attention?${query}`),
        );
        if (result.pagination.offset !== offset || result.pagination.limit !== TRIAGE_CAPS.pageSize)
          throw new Error('Attention pagination mismatch.');
        const parsed = this.members(
          result.events,
          attentionSessionSchema,
          TRIAGE_CAPS.pageSize,
          limit,
        );
        let skipped = 0;
        for (const event of parsed) {
          if (!isOpenItemCandidate(event)) {
            skipped++;
            continue;
          }
          if (ids.has(event.id)) {
            limit.truncated = true;
            continue;
          }
          ids.add(event.id);
          sessions.push(event);
        }
        const readCount = offset + result.events.length;
        this.deps.logger.debug('open_items_triage.attention.page', {
          offset,
          records: result.events.length,
          total: result.pagination.total,
          invalidRecords: limit.invalidRecords,
          skippedNonCandidates: skipped,
        });
        if (readCount >= result.pagination.total) break;
        if (
          result.events.length < TRIAGE_CAPS.pageSize ||
          page === TRIAGE_CAPS.attentionPages - 1
        ) {
          limit.truncated = true;
          break;
        }
      }
    } catch {
      this.failed(limit);
    }
    return {
      sessions,
      complete: !limit.unavailable && !limit.truncated && limit.invalidRecords === 0,
    };
  }

  private async goals(): Promise<GoalInput[]> {
    const limit = this.limit('goals');
    const userId = extractUserIdFromToken(this.accessToken);
    if (!userId) {
      this.failed(limit);
      return [];
    }
    try {
      const result = goalsSchema.parse(
        await this.read(`${this.base}/goals/active?${new URLSearchParams({ userId })}`),
      );
      if (result.userId !== userId) throw new Error('Goal user mismatch.');
      const goals = this.members(result.items, goalSchema, TRIAGE_CAPS.goals, limit);
      return await Promise.all(
        goals.map(async (goal) => {
          const trackedLimit = this.limit(`goal:${goal.id}:tracked`);
          let trackedItems: GoalInput['trackedItems'] = [];
          try {
            const detail = goalDetailSchema.parse(
              await this.read(`${this.base}/work-items/${goal.id}?includeTrackedEntities=true`),
            );
            if (detail.id !== goal.id) throw new Error('Goal identity unavailable.');
            if (detail.archivedAt) {
              this.archivedKeys.add(`TASK:${goal.id}`);
              return { ...goal, trackedItems };
            }
            trackedItems = this.members(
              detail.trackedEntities,
              trackedSchema,
              TRIAGE_CAPS.trackedPerGoal,
              trackedLimit,
            )
              .filter((item) => item.status !== 'ARCHIVED')
              .map((item) => ({
                entityId: item.targetEntityId,
                entityType: item.targetEntityType,
                title: item.title,
                ...(item.status !== undefined ? { status: item.status } : {}),
              }));
          } catch {
            this.failed(trackedLimit);
          }
          return { ...goal, trackedItems };
        }),
      );
    } catch {
      this.failed(limit);
      return [];
    }
  }

  private async connections(seeds: readonly LocalOpenItemsTriageItem[]) {
    const limit = this.limit('connectionSeeds');
    limit.truncated = seeds.length > TRIAGE_CAPS.connectionSeeds;
    const results = await Promise.all(
      seeds.slice(0, TRIAGE_CAPS.connectionSeeds).map(async (source) => {
        const recordLimit = this.limit(`connections:${itemKey(source)}`);
        const connections: Connection[] = [];
        try {
          const query = new URLSearchParams({
            relatedEntityDepth: '1',
            includeRelatedEntities: 'true',
            includeFeatureHierarchy: 'true',
            includeProposals: 'false',
            includeAvailableMcpTools: 'false',
          });
          const context = contextSchema.parse(
            await this.read(
              `${this.base}/entities/${source.entityType}/${source.entityId}/context?${query}`,
            ),
          );
          if (context.entityId !== source.entityId || context.entityType !== source.entityType)
            throw new Error('Context identity unavailable.');
          if (context.content?.status === 'ARCHIVED') {
            this.archivedKeys.add(itemKey(source));
            this.deps.logger.debug('open_items_triage.context.archived', {
              entityType: source.entityType,
              entityId: source.entityId,
            });
            return [];
          }
          for (const related of this.members(
            context.relatedEntities,
            relatedSchema,
            TRIAGE_CAPS.connectionsPerSeed,
            recordLimit,
          )) {
            if (related.status === 'ARCHIVED') this.archivedKeys.add(itemKey(related));
            if (related.status !== 'ARCHIVED')
              connections.push({
                source,
                target: {
                  entityId: related.entityId,
                  entityType: related.entityType,
                  title: related.displayName,
                },
                relationship: related.relationship,
              });
          }
          for (const parent of this.members(
            context.featureHierarchy,
            hierarchySchema,
            TRIAGE_CAPS.connectionsPerSeed,
            recordLimit,
          )) {
            if (parent.status === 'ARCHIVED') this.archivedKeys.add(`TASK:${parent.id}`);
            if (
              parent.status !== 'ARCHIVED' &&
              parent.distance === 1 &&
              parent.relationship === 'ancestor'
            )
              connections.push({
                source,
                target: { entityId: parent.id, entityType: 'TASK', title: parent.name },
                relationship: 'parent',
              });
            if (parent.relationshipType !== 'structural' && parent.direction) {
              const relationships = {
                DERIVES_FROM: ['derives-from', 'derived-from-by'],
                EVOLVES: ['evolves', 'evolved-by'],
                SUPERSEDES: ['supersedes', 'superseded-by'],
                DEPENDS_ON: ['depends-on', 'depended-on-by'],
              };
              const relationship = Object.entries(relationships).find(
                ([type]) => type === parent.relationshipType,
              )?.[1][parent.direction === 'outbound' ? 0 : 1];
              if (relationship && parent.status !== 'ARCHIVED')
                connections.push({
                  source,
                  target: { entityType: 'TASK', entityId: parent.id, title: parent.name },
                  relationship,
                });
            }
          }
          if (context.creatingProposalId)
            connections.push(...(await this.sourceConnection(source, context.creatingProposalId)));
        } catch {
          this.failed(recordLimit);
        }
        return connections;
      }),
    );
    return reduceConnections(
      results
        .flat()
        .filter(
          (connection) =>
            !this.archivedKeys.has(itemKey(connection.source)) &&
            !this.archivedKeys.has(itemKey(connection.target)),
        ),
      seeds.filter((seed) => !this.archivedKeys.has(itemKey(seed))),
    );
  }

  private async sourceConnection(
    source: LocalOpenItemsTriageItem,
    proposalId: string,
  ): Promise<Connection[]> {
    const limit = this.limit(`sourceConversation:${itemKey(source)}`);
    try {
      const proposal = sourceProposalSchema.parse(
        await this.read(`${this.base}/proposals/${proposalId}`),
      );
      if (
        proposal.id !== proposalId ||
        proposal.targetEntityId !== source.entityId ||
        proposal.targetEntityType !== source.entityType ||
        proposal.action !== 'CREATE' ||
        proposal.status !== 'APPROVED'
      )
        throw new Error('Source proposal mismatch.');
      if (!proposal.conversationId) return [];
      const conversation = sourceConversationSchema.parse(
        await this.read(`${this.base}/conversations/${proposal.conversationId}`),
      );
      if (conversation.id !== proposal.conversationId || conversation.projectId !== this.projectId)
        throw new Error('Source conversation unavailable.');
      if (conversation.status === 'ARCHIVED') {
        this.archivedKeys.add(`CONVERSATION:${conversation.id}`);
        return [];
      }
      return [
        {
          source,
          target: {
            entityType: 'CONVERSATION',
            entityId: conversation.id,
            ...(conversation.title ? { title: conversation.title } : {}),
          },
          relationship: 'created-via',
        },
      ];
    } catch {
      this.failed(limit);
      return [];
    }
  }

  public async build() {
    this.limits.length = 0;
    this.archivedKeys.clear();
    const collectionLimit = this.limit('collection');
    let collection: z.infer<typeof collectionSchema>;
    try {
      collection = collectionSchema.parse(await this.read(`${this.base}/open-items`));
    } catch {
      this.failed(collectionLimit);
      throw new Error('Open Items triage cannot read the required collection.');
    }
    const items =
      collection.state === 'PRESENT'
        ? this.members(collection.items, openItemSchema, TRIAGE_CAPS.items, collectionLimit).filter(
            (item) => item.removedAt === null,
          )
        : [];
    const groupLimit = this.limit('groups');
    const groups =
      collection.state === 'PRESENT'
        ? this.members(collection.groups, groupSchema, TRIAGE_CAPS.groups, groupLimit)
        : [];
    const openItems = items.map((item) => ({
      entityType: item.entityType,
      entityId: item.entityId,
      title: item.presentation.label,
    }));
    const [attention, goals] = await Promise.all([this.attention(), this.goals()]);
    const seeds = [
      ...new Map(
        [
          ...openItems,
          ...goals.flatMap((goal) => [
            { entityType: 'TASK' as const, entityId: goal.id, title: goal.name },
            ...goal.trackedItems,
          ]),
        ].map((item) => [itemKey(item), item]),
      ).values(),
    ];
    const sessionObservations = await this.sessionEvidence.build(
      openItems.filter((item) => !this.archivedKeys.has(itemKey(item))),
      this.limits,
      this.archivedKeys,
    );
    const connections = await this.connections(seeds);
    // Reopen candidates must be absent from the entire authoritative collection, including rows omitted by the input cap.
    const fullKeys =
      collection.state === 'PRESENT'
        ? new Set(
            collection.items.flatMap((record) => {
              const parsed = openItemSchema.safeParse(record);
              return parsed.success ? [itemKey(parsed.data)] : [];
            }),
          )
        : new Set<string>();
    const { openCounters, ...reduced } = reduceAttention(
      attention.sessions,
      openItems.filter((item) => !this.archivedKeys.has(itemKey(item))),
      this.now,
      attention.complete,
      this.archivedKeys,
      fullKeys,
    );
    const input = {
      collection: {
        state: collection.state,
        revision: collection.state === 'PRESENT' ? collection.revision : null,
        items: items
          .filter((item) => !this.archivedKeys.has(itemKey(item)))
          .map((item) => openItemRecord(item, openCounters.get(itemKey(item))!)),
        groups,
      },
      attention: reduced,
      sessionObservations,
      sessionSelection: {
        cap: SESSION_EVIDENCE_CAP,
        omittedCandidates: Math.max(
          0,
          selectSessionCandidates(openItems).length - SESSION_EVIDENCE_CAP,
        ),
      },
      goals: goals
        .filter((goal) => !this.archivedKeys.has(`TASK:${goal.id}`))
        .map((goal) => ({
          ...goal,
          trackedItems: goal.trackedItems.filter((item) => !this.archivedKeys.has(itemKey(item))),
        })),
      ...connections,
      caps: TRIAGE_CAPS,
      limits: [] as EvidenceLimit[],
    };
    const bytes = this.fitBudget(input);
    this.deps.logger.info('open_items_triage.input.ready', {
      items: items.length,
      goals: goals.length,
      sessions: attention.sessions.length,
      bytes,
      incompleteScopes: this.limits.filter((l) => l.unavailable || l.truncated || l.invalidRecords)
        .length,
    });
    return input;
  }

  // Lowest-value evidence goes first: the oldest timeline spans, then tracked items from the
  // last Goals, then the lowest-ranked connections.
  private fitBudget(input: {
    attention: { timeline: unknown[]; truncated: { timeline: boolean } };
    goals: { trackedItems: unknown[] }[];
    connections: unknown[];
    sessionObservations: SessionObservation[];
    truncated: boolean;
    limits: EvidenceLimit[];
  }): number {
    const finalize = () => {
      input.limits = [...this.limits].sort((a, b) => a.scope.localeCompare(b.scope));
      return inputBytes(input);
    };
    let bytes = finalize();
    if (bytes <= TRIAGE_INPUT_BUDGET_BYTES) return bytes;
    const timelineLimit = this.limit('budget:timeline');
    while (bytes > TRIAGE_INPUT_BUDGET_BYTES && input.attention.timeline.length > 0) {
      input.attention.timeline.shift();
      input.attention.truncated.timeline = true;
      timelineLimit.truncated = true;
      bytes = finalize();
    }
    if (bytes <= TRIAGE_INPUT_BUDGET_BYTES) return bytes;
    const trackedLimit = this.limit('budget:trackedItems');
    for (let g = input.goals.length - 1; g >= 0 && bytes > TRIAGE_INPUT_BUDGET_BYTES; g--) {
      const tracked = input.goals[g]!.trackedItems;
      while (bytes > TRIAGE_INPUT_BUDGET_BYTES && tracked.length > 0) {
        // Remove roughly the excess in one step; re-measuring after every item is quadratic.
        const perItem = inputBytes(tracked) / tracked.length;
        tracked.splice(-Math.ceil((bytes - TRIAGE_INPUT_BUDGET_BYTES) / perItem));
        trackedLimit.truncated = true;
        bytes = finalize();
      }
    }
    if (bytes <= TRIAGE_INPUT_BUDGET_BYTES) return bytes;
    const connectionLimit = this.limit('budget:connections');
    while (bytes > TRIAGE_INPUT_BUDGET_BYTES && input.connections.length > 0) {
      input.connections.pop();
      input.truncated = true;
      connectionLimit.truncated = true;
      bytes = finalize();
    }
    if (bytes > TRIAGE_INPUT_BUDGET_BYTES) {
      const sessionLimit = this.limit('budget:sessionObservations');
      while (bytes > TRIAGE_INPUT_BUDGET_BYTES && input.sessionObservations.length) {
        input.sessionObservations.pop();
        sessionLimit.truncated = true;
        bytes = finalize();
      }
    }
    return bytes;
  }
}

export type TriageInput = Awaited<ReturnType<TriageInputOwner['build']>>;
