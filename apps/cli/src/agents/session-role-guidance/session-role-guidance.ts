import { z } from 'zod';
import {
  EntityContextApi,
  EntityType,
  ProposalsApi,
  SessionRole,
  WorkItemTypesApi,
  TasksApi,
} from '../../shared/api/generated/api';
import { Configuration } from '../../shared/api/generated/configuration';
import type {
  FullEntityContextDto,
  WorkItemTypeDefinitionDto,
} from '../../shared/api/generated/api';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../prompt-type-handler';
import { resolveHandlerSessionRole } from '../prompt-type-handler';
import type { AgentStartupPromptInputResult } from '../../commands/agent-startup-prompt-input';
import type { RunStore } from '../../run-store/run-store';
import { readActiveWorkItemTypeDefinitions } from '../prompts/work-item-type-registry';
import {
  readMemoResearchFrame,
  researchFrameSchema,
  selectGuidanceReferences,
  type SelectedReference,
} from './selection';

const selectedSchema = z.object({ id: z.string(), type: z.string(), sources: z.array(z.string()) });
const stateSchema = z.object({
  references: z.array(selectedSchema),
  hasResearchFrame: z.boolean().default(false),
  deliveries: z.record(z.array(z.string())),
});
type GuidanceState = z.infer<typeof stateSchema>;
const payloadSchema = z.object({
  userMessage: z.string().optional(),
  _approvedPlanMarkdown: z.string().optional(),
  approvedVersion: z.object({ markdown: z.string() }).optional(),
  frame: researchFrameSchema.optional(),
});
const roleResultSchema = z.object({
  typeKey: z.string(),
  name: z.string(),
  sessionRole: z.nativeEnum(SessionRole),
  guidance: z.string().optional(),
});
const proposedTypeSchema = z.object({ type: z.string().min(1) });
export interface GuidanceResolution extends SelectedReference {
  typeKey?: string;
  kind?: string;
  title?: string;
  status: 'resolved' | 'archived' | 'unresolved';
  reason?: string;
  proposal?: {
    id: string;
    approvalState: string;
    action: string;
    targetId: string;
    targetKind: string;
    futureId?: string;
    futureRevision?: number;
    futureOutcome?: string;
  };
}
export interface PreparedRoleGuidance {
  text: string;
  deliveryKeys: string[];
  resolutions: GuidanceResolution[];
  failedTypeKeys: string[];
  selectionIssues?: string[];
}

/** Owns relevant identities and acknowledgements, separately from prompt rendering. */
export class SessionRoleGuidance {
  private state: GuidanceState | null = null;
  constructor(
    private readonly deps: Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>,
    private readonly store?: RunStore,
  ) {}

  private restore(session: AgenticSession): GuidanceState {
    if (!this.state) {
      const persisted = session.sessionContext?.['sessionRoleGuidance'];
      if (persisted !== undefined) this.state = stateSchema.parse(persisted);
      else this.state = { references: [], deliveries: {}, hasResearchFrame: false };
    }
    return this.state;
  }

  get continuity(): GuidanceState | null {
    return this.state;
  }

  private async persist(session: AgenticSession): Promise<void> {
    if (this.store && this.state)
      await this.store.updateRunSessionContext(session.agentic_session_id, {
        sessionRoleGuidance: this.state,
      });
  }

  async prepare<TPayload>(input: {
    session: AgenticSession;
    handler: PromptTypeHandler<TPayload>;
    payload: TPayload;
    startup?: AgentStartupPromptInputResult;
    fresh: boolean;
    userMessages?: readonly string[];
    definitions?: WorkItemTypeDefinitionDto[];
  }): Promise<PreparedRoleGuidance> {
    const { session, handler, startup } = input;
    const state = this.restore(session);
    const role = resolveHandlerSessionRole(handler, session);
    const payload = payloadSchema.parse(input.payload ?? {});
    let frame: z.infer<typeof researchFrameSchema> | undefined;
    for (const memo of session.memos ?? []) {
      const supplied = readMemoResearchFrame(memo.content);
      if (supplied !== undefined)
        frame = {
          nodes: [...(frame?.nodes ?? []), ...supplied.nodes],
          issues: [...(frame?.issues ?? []), ...(supplied.issues ?? [])],
        };
    }
    if (payload.frame !== undefined)
      frame = {
        nodes: [...(frame?.nodes ?? []), ...payload.frame.nodes],
        issues: [...(frame?.issues ?? []), ...(payload.frame.issues ?? [])],
      };
    if (frame !== undefined) state.hasResearchFrame = true;
    else if (state.hasResearchFrame) frame = { nodes: [] };
    const focal = session.entity
      ? { id: session.entity.entityId, type: session.entity.entityType }
      : null;
    const parent = startup?.loadedEntityContext.context.featureHierarchy
      ?.filter(
        (entry) => entry.relationshipType === 'structural' && entry.relationship === 'ancestor',
      )
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))[0];
    const selected = selectGuidanceReferences({
      focal,
      ...(frame !== undefined ? { frame } : {}),
      fallback: parent ? [{ id: parent.id, type: 'TASK' }] : [],
      ...((payload._approvedPlanMarkdown ?? payload.approvedVersion?.markdown)
        ? { approvedPlan: payload._approvedPlanMarkdown ?? payload.approvedVersion!.markdown }
        : {}),
      userMessages: [
        ...(input.userMessages ?? []),
        ...(payload.userMessage ? [payload.userMessage] : []),
      ],
    });
    for (const ref of selected) {
      const existing = state.references.find((entry) => entry.id === ref.id);
      if (existing) existing.sources = [...new Set([...existing.sources, ...ref.sources])];
      else state.references.push(ref);
    }
    const result: PreparedRoleGuidance = {
      text: '',
      deliveryKeys: [],
      resolutions: [],
      failedTypeKeys: [],
      selectionIssues: frame?.issues ?? [],
    };
    const sourcesInspected = {
      focalAvailable: focal !== null,
      researchFrameAvailable: frame !== undefined,
      taskParentFallbackEnabled: frame === undefined,
      approvedPlanAvailable:
        (payload._approvedPlanMarkdown ?? payload.approvedVersion?.markdown) !== undefined,
      userMessageCount: (input.userMessages?.length ?? 0) + (payload.userMessage ? 1 : 0),
      referenceCount: state.references.length,
    };
    if (result.selectionIssues?.length)
      this.deps.logger.warn('session_role_guidance.selection_incomplete', {
        issues: result.selectionIssues,
      });
    if (state.references.length === 0) {
      this.logSelection(session, role, result, sourcesInspected);
      return result;
    }
    await this.persist(session);
    try {
      const organizationId = session.contextMetadata?.organizationId;
      const projectId = session.contextMetadata?.projectId;
      if (!organizationId || !projectId)
        throw new Error('Role guidance requires project and organization scope');
      const token = await this.deps.auth.getAccessToken();
      const config = new Configuration({
        accessToken: token,
        basePath: this.deps.apiBaseUrl,
        baseOptions: { timeout: 15000 },
      });
      const contexts = new EntityContextApi(config);
      const proposals = new ProposalsApi(config);
      const types = new WorkItemTypesApi(config);
      const tasks = new TasksApi(config);
      const definitions =
        input.definitions ?? (await readActiveWorkItemTypeDefinitions(token, projectId));
      const knownKeys = new Set(definitions.map((definition) => definition.key));
      // Fixed entity kinds keep their boundary; all work-item aliases resolve
      // through TASK context and use its authoritative effective key.
      const canonicalKindFor = (kind: string): EntityType =>
        Object.values(EntityType).find((value) => value.toLowerCase() === kind.toLowerCase()) ??
        EntityType.Task;
      const contextCache = new Map<string, FullEntityContextDto>();
      if (startup) {
        const loaded = startup.loadedEntityContext;
        contextCache.set(loaded.focalEntity.entityId, {
          ...loaded.context,
          ...('type' in loaded.entity ? { taskType: loaded.entity.type } : {}),
          ...('status' in loaded.entity && loaded.entity.status === 'ARCHIVED'
            ? {
                content: {
                  ...loaded.context.content,
                  sections: loaded.context.content?.sections ?? {},
                  status: 'ARCHIVED',
                },
              }
            : {}),
        });
      }
      const contextFor = async (id: string, kind: string): Promise<FullEntityContextDto> => {
        const cached = contextCache.get(id);
        if (cached) return cached;
        const canonicalKind = canonicalKindFor(kind);
        const response = await contexts.getEntityContext({
          organizationId,
          projectId,
          entityId: id,
          entityType: canonicalKind,
          includeRelatedEntities: false,
          includeProposals: false,
        });
        if (!response.data.success || !response.data.data)
          throw new Error('Entity context unavailable');
        contextCache.set(id, response.data.data);
        return response.data.data;
      };
      if (frame === undefined && focal?.type === 'TASK') {
        try {
          const focalContext = await contextFor(focal.id, focal.type);
          const nearest = focalContext.featureHierarchy
            ?.filter(
              (entry) =>
                entry.relationshipType === 'structural' && entry.relationship === 'ancestor',
            )
            .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))[0];
          if (nearest) {
            const fallback = selectGuidanceReferences({
              fallback: [{ id: nearest.id, type: 'TASK' }],
            });
            for (const ref of fallback) {
              const previous = state.references.find((entry) => entry.id === ref.id);
              if (previous) previous.sources = [...new Set([...previous.sources, ...ref.sources])];
              else state.references.push(ref);
            }
            await this.persist(session);
          }
        } catch {
          this.deps.logger.warn('session_role_guidance.parent_context_unresolved', {
            entityId: focal.id,
          });
        }
      }
      for (const ref of state.references) {
        let proposal: GuidanceResolution['proposal'];
        try {
          let id = ref.id;
          let kind = ref.type;
          let createType: string | undefined;
          if (kind.toUpperCase() === 'PROPOSAL') {
            const response = await proposals.getProposal({
              organizationId,
              projectId,
              proposalId: id,
            });
            const item = response.data.data;
            if (!response.data.success || !item) throw new Error('Proposal unavailable');
            proposal = {
              id,
              approvalState: item.status,
              action: item.action,
              targetId: item.targetEntityId,
              targetKind: item.targetEntityType,
              ...(item.reviewedFuture
                ? {
                    futureId: item.reviewedFuture.id,
                    futureRevision: item.reviewedFuture.revision,
                    futureOutcome: item.reviewedFuture.outcome,
                  }
                : {}),
            };
            id = item.targetEntityId;
            kind = item.targetEntityType;
            if (item.action === 'CREATE' && canonicalKindFor(kind) === EntityType.Task)
              createType = proposedTypeSchema.parse(item.updates).type;
            if (item.action === 'CREATE') {
              result.resolutions.push({
                ...ref,
                status: 'resolved',
                ...(createType ? { typeKey: createType } : { kind }),
                ...(item.title ? { title: item.title } : {}),
                proposal,
              });
              continue;
            }
          }
          const context = await contextFor(id, kind);
          let status = context.content?.status;
          if (context.entityType === EntityType.Task && status === undefined) {
            const response = await tasks.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet(
              { organizationId, projectId, taskId: id },
            );
            if (!response.data.success || !response.data.data)
              throw new Error('Work-item status unavailable');
            status = response.data.data.status;
          }
          const archived = status === 'ARCHIVED';
          if (!archived && context.entityType === EntityType.Task && !context.taskType)
            throw new Error('Work-item type is unresolved');
          result.resolutions.push({
            ...ref,
            status: archived ? 'archived' : 'resolved',
            title: context.displayName,
            ...(context.taskType ? { typeKey: context.taskType } : { kind: context.entityType }),
            ...(proposal ? { proposal } : {}),
          });
        } catch {
          result.resolutions.push({
            ...ref,
            status: 'unresolved',
            reason: 'Authoritative identity/type read failed',
            ...(proposal ? { proposal } : {}),
          });
          this.deps.logger.warn('session_role_guidance.entity_unresolved', {
            entityId: ref.id,
            entityType: ref.type,
          });
        }
      }
      const delivered = input.fresh
        ? []
        : (state.deliveries[session.provider_session_id ?? ''] ?? []);
      const keys = [
        ...new Set(
          result.resolutions
            .filter(
              (item) => item.status === 'resolved' && item.typeKey && knownKeys.has(item.typeKey),
            )
            .map((item) => item.typeKey!),
        ),
      ].filter((key) => !delivered.includes(`${role}:${key}`));
      const blocks: string[] = [];
      const readAdvice = async (batch: string[]): Promise<void> => {
        try {
          const response = await types.getWorkItemTypeGuidanceBatch({
            organizationId,
            projectId,
            workItemTypeGuidanceBatchRequestDto: {
              typeKeys: batch,
              purpose: 'role',
              sessionRole: role,
            },
          });
          if (!response.data.success || !response.data.data)
            throw new Error('Guidance unavailable');
          const entries = z.array(roleResultSchema).parse(response.data.data.results);
          if (
            entries.length !== batch.length ||
            entries.some(
              (entry, index) => entry.typeKey !== batch[index] || entry.sessionRole !== role,
            )
          )
            throw new Error('Guidance identity mismatch');
          for (const entry of entries) {
            if (entry.guidance?.trim()) blocks.push(`### ${entry.name}\n${entry.guidance}`);
            // An authoritative omission is a successful read, distinct from failure.
            result.deliveryKeys.push(`${role}:${entry.typeKey}`);
          }
        } catch {
          if (batch.length > 1) {
            for (const key of batch) await readAdvice([key]);
          } else result.failedTypeKeys.push(...batch);
        }
      };
      for (let offset = 0; offset < keys.length; offset += 10)
        await readAdvice(keys.slice(offset, offset + 10));
      for (const resolution of result.resolutions) {
        if (
          resolution.status === 'resolved' &&
          resolution.typeKey &&
          !knownKeys.has(resolution.typeKey)
        ) {
          resolution.status = 'unresolved';
          resolution.reason = 'No active project-effective type definition';
        }
      }
      if (blocks.length)
        result.text = `## Session-role guidance (${role})\n\n${blocks.join('\n\n')}`;
      this.deps.logger.debug('session_role_guidance.prepared', {
        role,
        resolutions: result.resolutions,
        failedTypeKeys: result.failedTypeKeys,
        deliveryKeys: result.deliveryKeys,
      });
    } catch {
      // Shared access failure is distinct from an authoritative advice omission.
      // Keep the selected identities for retry; do not consume any delivery keys.
      result.resolutions = state.references.map((ref) => ({
        ...ref,
        status: 'unresolved',
        reason: 'Role-guidance dependency read failed',
      }));
      result.deliveryKeys = [];
      result.text = '';
      this.deps.logger.warn('session_role_guidance.dependency_read_failed', {
        referenceCount: state.references.length,
      });
    }
    this.logSelection(session, role, result, sourcesInspected);
    return result;
  }

  private logSelection(
    session: AgenticSession,
    role: SessionRole,
    result: PreparedRoleGuidance,
    sourcesInspected: {
      focalAvailable: boolean;
      researchFrameAvailable: boolean;
      taskParentFallbackEnabled: boolean;
      approvedPlanAvailable: boolean;
      userMessageCount: number;
      referenceCount: number;
    },
  ): void {
    const types = new Map<string, Set<string>>();
    for (const resolution of result.resolutions) {
      if (resolution.status !== 'resolved' || !resolution.typeKey) continue;
      const sources = types.get(resolution.typeKey) ?? new Set<string>();
      resolution.sources.forEach((source) => sources.add(source));
      types.set(resolution.typeKey, sources);
    }
    this.deps.logger.info('session_role_guidance.types_selected', {
      runId: session.agentic_session_id,
      providerSessionId: session.provider_session_id ?? null,
      role,
      sourcesInspected,
      types: [...types].map(([typeKey, sources]) => ({ typeKey, sources: [...sources] })),
      nonWorkItemKinds: [
        ...new Set(
          result.resolutions
            .filter((item) => item.status === 'resolved' && item.kind)
            .map((item) => item.kind!),
        ),
      ],
      archivedReferenceCount: result.resolutions.filter((item) => item.status === 'archived')
        .length,
      unresolvedReferenceCount: result.resolutions.filter((item) => item.status === 'unresolved')
        .length,
      failedTypeKeys: result.failedTypeKeys,
      selectionIssueCount: result.selectionIssues?.length ?? 0,
    });
  }

  async acknowledge(
    session: AgenticSession,
    providerSessionId: string,
    prepared: PreparedRoleGuidance,
  ): Promise<void> {
    const state = this.restore(session);
    state.deliveries[providerSessionId] = [
      ...new Set([...(state.deliveries[providerSessionId] ?? []), ...prepared.deliveryKeys]),
    ];
    await this.persist(session);
  }
}
