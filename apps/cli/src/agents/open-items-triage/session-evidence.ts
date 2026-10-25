import { z } from 'zod';
import {
  AgentSessionCurrentState,
  AgentSessionOutputAttentionState,
} from '../../shared/api/generated/api';
import type { LocalOpenItemsTriageItem } from '../../shared/agent-bridge-contract/generated';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { envelopeSchema } from './input-schemas';
import { itemKey } from './attention';
import type { EvidenceLimit } from './input-owner';

export const SESSION_EVIDENCE_CAP = 10;
const identitySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: z.string(),
});
const dateSchema = z.string().datetime({ offset: true });
const conversationSchema = z.string().uuid().nullable();
const stateSchema = z.object({
  agentSessionId: z.string().uuid(),
  currentState: z.nativeEnum(AgentSessionCurrentState),
  revision: z.number().int().nonnegative(),
  transitionedAt: dateSchema,
});
const outputSchema = z.object({
  agentSessionId: z.string().uuid(),
  state: z.nativeEnum(AgentSessionOutputAttentionState),
  revision: z.number().int().nonnegative(),
  changedAt: dateSchema,
});
const batchSchema = z.object({ items: z.array(envelopeSchema.shape.data) });
export interface SessionObservation {
  key: string;
  createdAt: string | null;
  conversationId: string | null;
  currentState: z.infer<typeof stateSchema> | null;
  outputAttention: z.infer<typeof outputSchema> | null;
}

export function selectSessionCandidates(items: readonly LocalOpenItemsTriageItem[]) {
  return [
    ...new Map(
      items.filter((i) => i.entityType === 'AGENT_SESSION').map((i) => [itemKey(i), i]),
    ).values(),
  ].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
}

// Session detail, Run activity and user output attention have independent failure scopes.
export class SessionEvidenceReader {
  constructor(
    private readonly deps: PromptTypeHandlerDeps,
    private readonly base: string,
    private readonly token: string,
    private readonly projectId: string,
  ) {}

  private async read(path: string, ids?: string[]) {
    this.deps.logger.debug('open_items_triage.session_read.started', { path, count: ids?.length });
    const response = await this.deps.fetchImpl(`${this.base}/agent-sessions/${path}`, {
      method: ids ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(ids ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(ids ? { body: JSON.stringify({ agentSessionIds: ids }) } : {}),
    });
    if (!response.ok) throw new Error(`Session observation failed (${response.status}).`);
    return envelopeSchema.parse(await response.json()).data;
  }

  async build(
    items: readonly LocalOpenItemsTriageItem[],
    limits: EvidenceLimit[],
    archived: Set<string>,
  ) {
    const candidates = selectSessionCandidates(items);
    limits.push({
      scope: 'sessionCandidates',
      truncated: candidates.length > SESSION_EVIDENCE_CAP,
      unavailable: false,
      invalidRecords: 0,
    });
    const selected = candidates.slice(0, SESSION_EVIDENCE_CAP);
    const observations: SessionObservation[] = selected.map((item) => ({
      key: itemKey(item),
      createdAt: null,
      conversationId: null,
      currentState: null,
      outputAttention: null,
    }));
    const limit = (scope: string) => {
      const value = { scope, truncated: false, unavailable: false, invalidRecords: 0 };
      limits.push(value);
      return value;
    };
    await Promise.all(
      selected.map(async (item, index) => {
        const detailLimit = limit(`session:${itemKey(item)}:detail`);
        try {
          const raw = await this.read(item.entityId);
          const identity = identitySchema.parse(raw);
          if (identity.id !== item.entityId || identity.projectId !== this.projectId)
            throw new Error('Session identity mismatch.');
          if (identity.status === 'ARCHIVED') {
            archived.add(itemKey(item));
            return;
          }
          const detail = z
            .object({
              createdAt: envelopeSchema.shape.data.optional(),
              conversationId: envelopeSchema.shape.data.optional(),
            })
            .parse(raw);
          const created = dateSchema.safeParse(detail.createdAt);
          const conversation = conversationSchema.safeParse(detail.conversationId);
          observations[index]!.createdAt = created.success ? created.data : null;
          observations[index]!.conversationId = conversation.success ? conversation.data : null;
          if (!created.success || !conversation.success) detailLimit.invalidRecords++;
        } catch {
          this.deps.logger.debug('open_items_triage.session_detail.unavailable', {
            key: itemKey(item),
          });
          detailLimit.unavailable = true;
        }
      }),
    );
    if (selected.length)
      await Promise.all(
        (['current-state:batch', 'output-attention:batch'] as const).map(async (path) => {
          const scope = limit(`sessions:${path}`);
          try {
            const result = batchSchema.parse(
              await this.read(
                path,
                selected.map((i) => i.entityId),
              ),
            );
            scope.truncated = result.items.length > SESSION_EVIDENCE_CAP;
            const seen = new Set<string>();
            for (const raw of result.items.slice(0, SESSION_EVIDENCE_CAP)) {
              const parsed =
                path === 'current-state:batch'
                  ? stateSchema.safeParse(raw)
                  : outputSchema.safeParse(raw);
              if (!parsed.success) {
                scope.invalidRecords++;
                continue;
              }
              const key = `AGENT_SESSION:${parsed.data.agentSessionId}`;
              const observation = observations.find((o) => o.key === key);
              if (!observation || seen.has(key)) {
                scope.invalidRecords++;
                continue;
              }
              seen.add(key);
              if ('currentState' in parsed.data) observation.currentState = parsed.data;
              else observation.outputAttention = parsed.data;
            }
          } catch {
            scope.unavailable = true;
          }
          this.deps.logger.debug('open_items_triage.session_batch.completed', { ...scope });
        }),
      );
    this.deps.logger.debug('open_items_triage.session_read.completed', {
      selected: selected.length,
      omitted: candidates.length - selected.length,
    });
    return observations.filter((o) => !archived.has(o.key));
  }
}
