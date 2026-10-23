import type { WorkItemTypeGuidanceDto } from '../../generated/model/workItemTypeGuidanceDto';
import type { WorkItemTypeGuidanceBatchDto } from '../../generated/model/workItemTypeGuidanceBatchDto';
import type { WorkItemTypeGuidanceBatchRequestDto } from '../../generated/model/workItemTypeGuidanceBatchRequestDto';
import type { WorkItemTypeMaintenanceGuidanceDto } from '../../generated/model/workItemTypeMaintenanceGuidanceDto';
import { WorkItemTypeGuidancePurpose } from '../../generated/model/workItemTypeGuidancePurpose';
import {
  diagramElementPolicySchema,
  DIAGRAM_ELEMENT_METADATA_SCHEMA_REF,
} from './diagram-metadata';
import { workItemTypeAgentGuidanceSchema } from './work-item-type-agent-guidance.schema';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, WorkItemType, WorkItemTypeTemplate } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from 'src/prisma/prisma.service';
import { MESSAGE_BUS_TOKEN } from 'src/core/events/tokens';
import { MessageBus } from 'src/core/events/message-bus.interface';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  WorkItemTypeConfigChangedEvent,
  isWorkItemTypeConfigChangedEvent,
} from 'src/core/events/types/domain-events';
import { EntityType } from '../../generated/model/entityType';
import { ReportType } from '../../generated/model/reportType';
import type { WorkItemConfigKind } from '../../generated/model/workItemConfigKind';

import { WorkStatus } from '../../generated/model/workStatus';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import type { WorkItemTypeRole } from '../../generated/model/workItemTypeRole';
import type { WorkItemTypeEdgeTarget } from '../../generated/model/workItemTypeEdgeTarget';
import type { WorkItemTypeGraphCapability } from '../../generated/model/workItemTypeGraphCapability';
import { WorkItemTypeGraphReadExpansionHop } from '../../generated/model/workItemTypeGraphReadExpansionHop';
import { WorkItemColorKey } from '../../generated/model/workItemColorKey';
import { WorkItemIconKey } from '../../generated/model/workItemIconKey';
import type { WorkItemTypeScalarField } from '../../generated/model/workItemTypeScalarField';
import type { WorkItemTypeSectionDefinition } from '../../generated/model/workItemTypeSectionDefinition';
import type { WorkItemTypeTracking } from '../../generated/model/workItemTypeTracking';
import type { WorkItemTypeWritingStandards } from '../../generated/model/workItemTypeWritingStandards';
import type { ProjectedWorkItem } from '../../generated/model/projectedWorkItem';
import type { ProjectedWorkItemRelationship } from '../../generated/model/projectedWorkItemRelationship';
import { WorkItemTypeLifecycleStatus } from '../../generated/model/workItemTypeLifecycleStatus';
import type { WorkItemTypeSummaryDto } from '../../generated/model/workItemTypeSummaryDto';
import { WorkItemTypeEffectiveSource } from '../../generated/model/workItemTypeEffectiveSource';
import { OrganizationId, ProjectId } from 'src/types';
import {
  CANONICAL_REFINEMENT_LEVELS,
  TaskRefinementLevel,
} from '../../utils/task-refinement-profile.util';
import {
  materializeWorkItemTypeCapabilities,
  splitWorkItemTypeCapabilities,
  workItemTypeGraphCapabilitySchema,
} from './work-item-type-capabilities.schema';
import {
  WORK_ITEM_CAPABILITY_KEYS as CAP,
  readCapability,
} from './work-item-type-capabilities';
import {
  type TrackingEligibilityIndex,
  type TrackingRules,
  WorkItemTypeRelationshipIndex,
} from './work-item-type-relationship-index';

export type TaskScalarField = 'dueDate' | 'tag';

export interface InitialStatusPolicy {
  readonly initialStatus: WorkStatus;
  readonly hasSetInitialStatus: boolean;
}

export type {
  TrackingEligibilityIndex,
  TrackingRules,
} from './work-item-type-relationship-index';

/**
 * The engine-facing rules for one work-item type — every per-type axis the
 * validator, refinement, and placement paths read. DERIVED from a single stored
 * {@link WorkItemTypeDefinitionDto} by {@link deriveRules}; nothing reads it off
 * the row directly.
 */
export interface WorkItemTypeRules {
  readonly role: WorkItemTypeRole;
  /** Explicit launch-config policy; omitted legacy definitions resolve empty. */
  readonly acceptedConfigKinds: readonly WorkItemConfigKind[];
  readonly allowedStatuses: readonly WorkStatus[];
  readonly initialStatusPolicy: InitialStatusPolicy;
  readonly sections: readonly string[];
  readonly sectionDefinitions: readonly WorkItemTypeSectionDefinition[];
  readonly requiredScalars: readonly TaskScalarField[];
  readonly forbiddenScalars: readonly TaskScalarField[];
  readonly requiresParent: boolean;
  /**
   * Type keys an item of this type may be parented under (the child-side
   * parentage axis). A custom type names the parent types it attaches under
   * here (e.g. `["FEATURE"]`). Runtime placement requires this declaration.
   * Empty means no Task subtype may parent the child; it does not mean that
   * the subtype axis is unconstrained.
   */
  readonly allowedParentTaskTypes: readonly string[];
  readonly tracking: TrackingRules;
  readonly writingStandards: WorkItemTypeWritingStandards;
  readonly parentage: {
    readonly allowedParentEntityTypes: readonly EntityType[];
  };
  readonly allowedEdgeTargetEntityTypes: readonly EntityType[];
  readonly agentSettableStatuses: readonly WorkStatus[];
  readonly planEligible: boolean;
  readonly rendersInline: boolean;
  readonly showsInExplorerSidebar: boolean;
  readonly graph: WorkItemTypeGraphCapability | null;
  readonly anchorableReportTypes: readonly ReportType[];
}

export interface ProjectedTopologySemantics {
  isFeature(node: ProjectedWorkItem): boolean;
  isWorkflow(node: ProjectedWorkItem): boolean;
  isWorkflowStep(node: ProjectedWorkItem): boolean;
  isContract(node: ProjectedWorkItem): boolean;
  isFulfillment(relationship: ProjectedWorkItemRelationship): boolean;
  isContractDependency(relationship: ProjectedWorkItemRelationship): boolean;
  isFlow(relationship: ProjectedWorkItemRelationship): boolean;
}
/** Every entity type — the uniform edge-target set every built-in carries. */
const ALL_ENTITY_TYPES = Object.values(EntityType) as readonly EntityType[];

/** Neutral tracking rules for a type whose definition declares no tracking. */
const NEUTRAL_TRACKING: TrackingRules = {
  allowedSourceEntityTypes: [],
  allowedSourceTaskTypes: [],
};

/** Empty type-level standards for a definition that carries none. */
const EMPTY_WRITING_STANDARDS: WorkItemTypeWritingStandards = {
  create: '',
  edit: '',
};

function readGraphCapability(
  capabilities: WorkItemTypeDefinitionDto['capabilities'],
): WorkItemTypeGraphCapability | null {
  return capabilities?.graph ?? null;
}

function resolveGraphCapability(
  graph: unknown,
): WorkItemTypeGraphCapability | null {
  if (graph === null || graph === undefined) {
    return null;
  }
  return workItemTypeGraphCapabilitySchema.parse(graph);
}

/**
 * Compute the engine-facing rules for one type from its stored definition. This
 * is the single place a {@link WorkItemTypeDefinitionDto} becomes
 * {@link WorkItemTypeRules}; every axis traces to a definition field or the
 * capability map, with two derivations the DTO does not store directly:
 *   - `initialStatus` is the FIRST allowed status (the reseed orders the list so
 *     the intended initial status leads), and `hasSetInitialStatus` is a
 *     capability flag.
 *   - `allowedEdgeTargetEntityTypes` is the uniform {@link ALL_ENTITY_TYPES}; no
 *     definition field narrows it.
 * Pure and exported so the parity guard can exercise it against the built-ins.
 */
export function deriveRules(
  definition: WorkItemTypeDefinitionDto,
): WorkItemTypeRules {
  assertValidMockupSizeProfiles(definition.sections);
  const caps = definition.capabilities;
  const graph = resolveGraphCapability(readGraphCapability(caps));
  const allowedStatuses =
    definition.allowedStatuses as unknown as readonly WorkStatus[];
  const allowedParentTaskTypes = (definition.allowedParentTypes ??
    []) as readonly string[];

  return {
    role: definition.role,
    acceptedConfigKinds: (definition.acceptedConfigKinds ??
      []) as readonly WorkItemConfigKind[],
    allowedStatuses,
    initialStatusPolicy: {
      initialStatus: allowedStatuses[0] ?? WorkStatus.Backlog,
      hasSetInitialStatus: readCapability(caps, CAP.hasSetInitialStatus),
    },
    sections: definition.sections.map((section) => section.key),
    sectionDefinitions: definition.sections,
    requiredScalars: (definition.requiredScalars ??
      []) as unknown as readonly TaskScalarField[],
    forbiddenScalars: (definition.forbiddenScalars ??
      []) as unknown as readonly TaskScalarField[],
    requiresParent: readCapability(caps, CAP.requiresParent),
    allowedParentTaskTypes,
    tracking: (definition.tracking ?? NEUTRAL_TRACKING) as TrackingRules,
    writingStandards: (definition.writingStandards ??
      EMPTY_WRITING_STANDARDS) as WorkItemTypeWritingStandards,
    parentage: {
      allowedParentEntityTypes: (definition.allowedParentEntityTypes ??
        []) as readonly EntityType[],
    },
    allowedEdgeTargetEntityTypes: ALL_ENTITY_TYPES,
    agentSettableStatuses: (definition.agentSettableStatuses ??
      []) as unknown as readonly WorkStatus[],
    planEligible: readCapability(caps, CAP.planEligible),
    rendersInline: readCapability(caps, CAP.rendersInline),
    showsInExplorerSidebar: readCapability(caps, CAP.showsInExplorerSidebar),
    graph,
    anchorableReportTypes: (definition.anchorableReportTypes ??
      []) as unknown as readonly ReportType[],
  };
}

export function assertValidMockupSizeProfiles(
  sections: readonly WorkItemTypeSectionDefinition[],
): void {
  for (const section of sections) {
    if (section.diagramElementPolicy !== undefined) {
      if (section.schemaRef !== DIAGRAM_ELEMENT_METADATA_SCHEMA_REF) {
        throw new BadRequestException(
          'Diagram element policy requires the DiagramElementMetadata schema.',
        );
      }
      const policy = diagramElementPolicySchema.parse(
        section.diagramElementPolicy,
      );
      const keys = policy.roles.map((role) => role.key);
      if (
        new Set(keys).size !== keys.length ||
        !keys.includes('GENERIC') ||
        !keys.includes('DIAGRAM_REFERENCE')
      ) {
        throw new BadRequestException(
          'Diagram roles must be unique and include GENERIC and DIAGRAM_REFERENCE.',
        );
      }
      if (
        policy.referenceTargets.some(
          (rule) =>
            rule.entityType !== 'TASK' && rule.workItemTypeKeys !== undefined,
        )
      ) {
        throw new BadRequestException(
          'Only TASK reference targets may declare work-item type keys.',
        );
      }
    }
    const profiles = section.sizeProfiles;
    const defaultKey = section.defaultSizeKey;
    const supportsSizing =
      section.kind === 'html/css' || section.kind === 'structured-mockup';
    if (!supportsSizing) {
      if (profiles !== undefined || defaultKey !== undefined) {
        throw new BadRequestException(
          `Section '${section.key}' may configure size profiles only when kind is html/css or structured-mockup.`,
        );
      }
      continue;
    }
    if (profiles === undefined && defaultKey === undefined) continue;
    if (!profiles?.length || !defaultKey) {
      throw new BadRequestException(
        `Mockup section '${section.key}' requires sizeProfiles and defaultSizeKey together.`,
      );
    }
    const keys = new Set<string>();
    for (const profile of profiles) {
      if (!profile.key || !profile.label || keys.has(profile.key)) {
        throw new BadRequestException(
          `Mockup section '${section.key}' has an invalid or duplicate size profile key.`,
        );
      }
      keys.add(profile.key);
      let previous = -1;
      for (const breakpoint of profile.breakpoints) {
        const dimensions = [breakpoint.inline, breakpoint.page];
        if (
          breakpoint.minContainerWidth < 0 ||
          breakpoint.minContainerWidth <= previous ||
          dimensions.some(
            ({ width, height }) =>
              !Number.isInteger(width) ||
              !Number.isInteger(height) ||
              width <= 0 ||
              height <= 0,
          )
        ) {
          throw new BadRequestException(
            `HTML/CSS size profile '${profile.key}' must have strictly ordered breakpoints and positive integer dimensions.`,
          );
        }
        previous = breakpoint.minContainerWidth;
      }
      if (profile.breakpoints[0]?.minContainerWidth !== 0) {
        throw new BadRequestException(
          `HTML/CSS size profile '${profile.key}' must begin at container width 0.`,
        );
      }
    }
    if (!keys.has(defaultKey)) {
      throw new BadRequestException(
        `HTML/CSS section '${section.key}' defaultSizeKey '${defaultKey}' does not name a configured profile.`,
      );
    }
  }
}

/**
 * Snapshot-backed read surface for per-type rule configuration.
 *
 * Warms an in-memory snapshot of the `work_item_type` rows at startup and
 * exposes per-type accessors over it. Postgres is the system of record; the
 * in-memory maps are a hot-path cache. Every effective definition is keyed by
 * owning project, so canonical and custom keys share one resolution path.
 *
 * Every accessor is synchronous against the snapshot: reads sit on the validator
 * and proposal paths and must never go async. Refreshes happen at startup,
 * on recovery ticks and invalidation signals, so the maps a reader touches are
 * always pre-built.
 *
 * NAMING: distinct from the unrelated refinement-pipeline `WorkItemTypeConfigService`
 * in `src/config/work-item-type.config.ts` (keyed by EntityType, governs
 * refinement levels). This service governs the per-type rule axes.
 */
@Injectable()
export class WorkItemTypeRegistryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkItemTypeRegistryService.name);
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private refreshPromise?: Promise<void>;
  private refreshRequested = false;
  private readonly pendingProjects = new Set<string>();
  private recoveryRequested = false;
  private fingerprints = new Map<string | null, string>();
  private destroyed = false;

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    clearInterval(this.recoveryTimer);
    await this.refreshPromise?.catch(() => undefined);
  }

  /** All project-scoped read models are replaced together after refresh. */
  private snapshot: {
    projectRules: Map<string, Map<string, WorkItemTypeRules>>;
    projectTypeActivity: Map<string, Map<string, string>>;
    projectSummaries: Map<string, WorkItemTypeSummaryDto[]>;
    projectRelationships: Map<string, WorkItemTypeRelationshipIndex>;
  } = {
    projectRules: new Map(),
    projectTypeActivity: new Map(),
    projectSummaries: new Map(),
    projectRelationships: new Map(),
  };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_BUS_TOKEN) private readonly messageBus: MessageBus,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Warming work-item type registry snapshot');
      await this.refresh();
      // Unit registries intentionally build partial canonical catalogs to test
      // one rule axis at a time. Every deployed runtime must load the complete
      // protected Plan hierarchy after the additive migration.
      if (process.env.NODE_ENV !== 'test') {
        this.assertCanonicalPlanDefinitions();
      }
      await this.messageBus.subscribe(
        EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED,
        (envelope) => {
          if (!isWorkItemTypeConfigChangedEvent(envelope.event)) return;
          this.logger.log(
            'Received work_item_type.config_changed — refreshing snapshot',
          );
          // Fire-and-forget: bus handlers are synchronous void. Any refresh
          // failure is logged inside refresh() and must not crash the bus.
          void this.refresh(envelope.event.payload.projectId).catch((error) => {
            this.logger.error(
              'Failed to refresh work-item type snapshot after invalidation',
              error as Error,
            );
          });
        },
      );
      if (!this.destroyed) {
        this.recoveryTimer = setInterval(() => {
          void this.recover().catch((error) => {
            this.logger.error(
              'Failed to recover work-item type snapshot',
              error as Error,
            );
          });
        }, 5000);
        this.recoveryTimer.unref();
      }
    } catch (error) {
      await this.onModuleDestroy();
      throw error;
    }
  }

  private assertCanonicalPlanDefinitions(): void {
    for (const [projectId, rules] of this.snapshot.projectRules) {
      const plan = rules.get(WORK_ITEM_TYPE_KEYS.Plan);
      const stage = rules.get(WORK_ITEM_TYPE_KEYS.PlanStage);
      const standard = rules.get(WORK_ITEM_TYPE_KEYS.Standard);
      const valid =
        plan?.allowedParentTaskTypes.includes(WORK_ITEM_TYPE_KEYS.Feature) ===
          true &&
        stage?.allowedParentTaskTypes.includes(WORK_ITEM_TYPE_KEYS.Plan) ===
          true &&
        standard?.allowedParentTaskTypes.includes(
          WORK_ITEM_TYPE_KEYS.PlanStage,
        ) === true;

      if (!valid) {
        throw new Error(
          `Project ${projectId} lacks the protected PLAN -> PLAN_STAGE -> STANDARD registry parentage contract.`,
        );
      }
    }
  }

  /**
   * Serialize loads and coalesce triggers during a load into a trailing reload.
   */
  refresh(projectId?: string): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (projectId === undefined) this.refreshRequested = true;
    else this.pendingProjects.add(projectId);
    return this.coordinateRefresh();
  }

  private recover(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.recoveryRequested = true;
    return this.coordinateRefresh();
  }

  private hasPendingRefresh(): boolean {
    return (
      this.refreshRequested ||
      this.recoveryRequested ||
      this.pendingProjects.size > 0
    );
  }

  private coordinateRefresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = Promise.resolve().then(async () => {
        try {
          do {
            let full = this.refreshRequested;
            const projects = new Set(this.pendingProjects);
            const recovery = this.recoveryRequested;
            this.refreshRequested = false;
            this.recoveryRequested = false;
            this.pendingProjects.clear();
            try {
              let observed: Map<string | null, string> | undefined;
              if (recovery) {
                observed = await this.readFingerprints();
                // The first recovery establishes a verified baseline. A canonical
                // change affects all projects; ordinary changes stay project-scoped.
                if (observed.get(null) !== this.fingerprints.get(null))
                  full = true;
                for (const id of new Set([
                  ...observed.keys(),
                  ...this.fingerprints.keys(),
                ])) {
                  if (
                    id !== null &&
                    observed.get(id) !== this.fingerprints.get(id)
                  )
                    projects.add(id);
                }
              }
              if (full || projects.size)
                await this.loadSnapshot(full ? undefined : [...projects]);
              // Record the pre-load observation only after success. A concurrent
              // commit remains detectable on the next tick, including deletions.
              if (observed) this.fingerprints = observed;
            } catch (error) {
              if (!this.hasPendingRefresh() || this.destroyed) throw error;
              if (full) this.refreshRequested = true;
              for (const id of projects) this.pendingProjects.add(id);
              if (recovery) this.recoveryRequested = true;
              this.logger.error(
                'Snapshot load failed; retrying queued refresh',
                error as Error,
              );
            }
          } while (this.hasPendingRefresh() && !this.destroyed);
        } finally {
          this.refreshPromise = undefined;
        }
      });
    }
    return this.refreshPromise;
  }

  private async readFingerprints(): Promise<Map<string | null, string>> {
    // Hash stored content, not updated_at: Flyway/direct SQL can bypass Prisma's
    // timestamp maintenance. Return one compact fingerprint per project.
    const rows = await this.prisma.$queryRaw<
      Array<{ projectId: string | null; fingerprint: string }>
    >(Prisma.sql`
      SELECT p.id AS "projectId",
        md5(COALESCE(string_agg(md5(to_jsonb(w)::text), '' ORDER BY w.id)
          FILTER (WHERE w.id IS NOT NULL), '')) AS fingerprint
      FROM projects p LEFT JOIN work_item_type w ON w.project_id = p.id
      GROUP BY p.id
      UNION ALL
      SELECT NULL AS "projectId",
        md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t.id), '')) AS fingerprint
      FROM work_item_type_template t
    `);
    return new Map(rows.map((row) => [row.projectId, row.fingerprint]));
  }

  /** Derive the canonical base plus complete overrides, then replace atomically. */
  private async loadSnapshot(projectIds?: string[]): Promise<void> {
    const reads = [
      this.prisma.project.findMany({
        select: { id: true },
        ...(projectIds ? { where: { id: { in: projectIds } } } : {}),
      }),
      this.prisma.workItemType.findMany(
        projectIds ? { where: { projectId: { in: projectIds } } } : undefined,
      ),
      this.prisma.workItemTypeTemplate.findMany(),
    ] as const;
    const [projects, rows, templates] = await Promise.all(reads).catch(
      async (error) => {
        // A rejected read must not release the coordinator while sibling reads run.
        await Promise.allSettled(reads);
        throw error;
      },
    );
    const nextProjectRules = new Map<string, Map<string, WorkItemTypeRules>>();
    const nextProjectActivity = new Map<string, Map<string, string>>();
    const nextProjectSummaries = new Map<string, WorkItemTypeSummaryDto[]>();

    const canonicalKeys = new Set(templates.map((row) => row.typeKey));
    const rowsByProject = new Map<string, WorkItemType[]>();
    for (const row of rows) {
      const projectRows = rowsByProject.get(row.projectId) ?? [];
      projectRows.push(row);
      rowsByProject.set(row.projectId, projectRows);
    }
    for (const project of projects) {
      for (const template of templates) {
        const definition = this.materializeTemplateDefinition(template);
        const rules = nextProjectRules.get(project.id) ?? new Map();
        rules.set(template.typeKey, deriveRules(definition));
        nextProjectRules.set(project.id, rules);
        const activity = nextProjectActivity.get(project.id) ?? new Map();
        activity.set(template.typeKey, 'active');
        nextProjectActivity.set(project.id, activity);
        const summaries = nextProjectSummaries.get(project.id) ?? [];
        summaries.push({
          id: template.id,
          definition,
          status: WorkItemTypeLifecycleStatus.Active,
          projectId: project.id as ProjectId,
          effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        });
        nextProjectSummaries.set(project.id, summaries);
      }
      for (const row of rowsByProject.get(project.id) ?? []) {
        const definition = this.rowToDefinition(row);
        if (!definition) {
          throw new Error(
            `Cannot load work-item type '${row.typeKey}' for project ${row.projectId}: ` +
              'the persisted override is not a complete definition.',
          );
        }
        const activity =
          nextProjectActivity.get(row.projectId) ?? new Map<string, string>();
        activity.set(row.typeKey, row.lifecycleStatus);
        nextProjectActivity.set(row.projectId, activity);
        const rulesMap =
          nextProjectRules.get(row.projectId) ??
          new Map<string, WorkItemTypeRules>();
        rulesMap.set(row.typeKey, deriveRules(definition));
        nextProjectRules.set(row.projectId, rulesMap);
        const summaries = nextProjectSummaries.get(row.projectId) ?? [];
        const prior = summaries.findIndex(
          (item) => item.definition.key === row.typeKey,
        );
        const summary = this.toSummary(
          row,
          definition,
          canonicalKeys.has(row.typeKey)
            ? WorkItemTypeEffectiveSource.CanonicalOverride
            : WorkItemTypeEffectiveSource.ProjectCustom,
        );
        if (prior >= 0) summaries[prior] = summary;
        else summaries.push(summary);
        nextProjectSummaries.set(row.projectId, summaries);
      }
    }

    this.validateGraphReadExpansionSnapshots(
      nextProjectRules,
      nextProjectActivity,
    );

    const nextProjectRelationships = new Map<
      string,
      WorkItemTypeRelationshipIndex
    >();
    for (const [projectId, activity] of nextProjectActivity) {
      const rules = nextProjectRules.get(projectId);
      const activeDefinitions = [...activity].flatMap(
        ([typeKey, lifecycleStatus]) => {
          const definitionRules = rules?.get(typeKey);
          return lifecycleStatus === 'active' && definitionRules
            ? [
                {
                  typeKey,
                  allowedParentTaskTypes:
                    definitionRules.allowedParentTaskTypes,
                  allowedParentEntityTypes:
                    definitionRules.parentage.allowedParentEntityTypes,
                  tracking: definitionRules.tracking,
                },
              ]
            : [];
        },
      );
      nextProjectRelationships.set(
        projectId,
        WorkItemTypeRelationshipIndex.build(activeDefinitions),
      );
    }

    if (projectIds) {
      // Clone the outer maps and replace only affected projects. Every accessor
      // for an unaffected project keeps the same already-derived snapshot.
      const merge = <T>(previous: Map<string, T>, next: Map<string, T>) => {
        const merged = new Map(previous);
        for (const id of projectIds) merged.delete(id);
        for (const [id, value] of next) merged.set(id, value);
        return merged;
      };
      this.snapshot = {
        projectRules: merge(this.snapshot.projectRules, nextProjectRules),
        projectTypeActivity: merge(
          this.snapshot.projectTypeActivity,
          nextProjectActivity,
        ),
        projectSummaries: merge(
          this.snapshot.projectSummaries,
          nextProjectSummaries,
        ),
        projectRelationships: merge(
          this.snapshot.projectRelationships,
          nextProjectRelationships,
        ),
      };
      return;
    }
    this.snapshot = {
      projectRules: nextProjectRules,
      projectTypeActivity: nextProjectActivity,
      projectSummaries: nextProjectSummaries,
      projectRelationships: nextProjectRelationships,
    };
    this.logger.log(
      `Work-item type registry snapshot loaded: ${[
        ...nextProjectRules.values(),
      ].reduce((sum, map) => sum + map.size, 0)} project-owned types across ${
        nextProjectRules.size
      } projects`,
    );
  }

  private validateGraphReadExpansionSnapshots(
    projectRules: Map<string, Map<string, WorkItemTypeRules>>,
    projectActivity: Map<string, Map<string, string>>,
  ): void {
    const supportedTraversalTypes = new Set(
      Object.values(WorkItemTypeGraphReadExpansionHop.RelationshipTypeEnum),
    );
    for (const [projectId, rulesByType] of projectRules) {
      const activity = projectActivity.get(projectId) ?? new Map();
      for (const [typeKey, rules] of rulesByType) {
        const graph = rules.graph;
        if (!graph) continue;

        const keys = new Set<string>();
        for (const expansion of graph.readExpansions ?? []) {
          if (keys.has(expansion.key)) {
            throw new Error(
              `Work-item type '${typeKey}' in project ${projectId} declares duplicate graph read expansion key '${expansion.key}'.`,
            );
          }
          keys.add(expansion.key);

          if (
            expansion.seed === 'graphNodes' &&
            activity.get(graph.nodeChildType) !== 'active'
          ) {
            throw new Error(
              `Work-item type '${typeKey}' in project ${projectId} seeds expansion '${expansion.key}' from inactive graph node type '${graph.nodeChildType}'.`,
            );
          }

          for (const hop of expansion.path) {
            if (!supportedTraversalTypes.has(hop.relationshipType)) {
              throw new Error(
                `Work-item type '${typeKey}' in project ${projectId} declares unsupported graph traversal label '${hop.relationshipType}'.`,
              );
            }
            if (
              hop.target.workItemTypeKeys?.length &&
              !hop.target.entityTypes.includes('TASK')
            ) {
              throw new Error(
                `Work-item type '${typeKey}' expansion '${expansion.key}' constrains work-item keys without a TASK target.`,
              );
            }
            for (const targetTypeKey of hop.target.workItemTypeKeys ?? []) {
              if (activity.get(targetTypeKey) !== 'active') {
                throw new Error(
                  `Work-item type '${typeKey}' expansion '${expansion.key}' references inactive work-item type '${targetTypeKey}'.`,
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * Publish a cross-instance invalidation so every instance re-warms its
   * snapshot from Postgres within seconds. Call this from any write path that
   * mutates a work_item_type row. `aggregateId` carries the affected type key
   * (or 'ALL') and, alongside the unique id, keeps two rapid invalidations from
   * colliding in the bus's dedup window. `organizationId` is the acting org from
   * the write path; the signal still reaches every instance regardless of org.
   */
  async publishConfigChanged(
    organizationId: OrganizationId,
    typeKey = 'ALL',
    projectId?: string,
  ): Promise<void> {
    const event: WorkItemTypeConfigChangedEvent = {
      id: uuidv4(),
      type: EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED,
      aggregateId: typeKey,
      payload: {
        organizationId,
        ...(projectId === undefined
          ? {}
          : { projectId: projectId as ProjectId }),
      },
    };
    this.logger.log(`Publishing work_item_type.config_changed for ${typeKey}`);
    await this.messageBus.publish({
      event,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Persist an accepted custom type definition as a project-owned active
   * `work_item_type` row inside the caller's transaction so the row
   * commits or rolls back atomically with the proposal approval. Returns a
   * post-commit runner that publishes the cross-instance invalidation AFTER the
   * tx commits — publishing inside the tx would race other instances into
   * refreshing before the row is visible, leaving the new type missing from
   * their snapshots until the next unrelated signal.
   *
   * The definition is stored FAITHFULLY: every column maps straight to a
   * definition field (or the capability map). {@link refresh} then runs
   * {@link deriveRules} over this row exactly as it does for the built-ins, so
   * the custom type resolves through the per-type accessors in its project's
   * scope. There are no placeholder columns — the row IS the definition.
   *
   * Key collision and unrecognized-reference checks already ran at proposal
   * time in the validation engine, so this path does not re-gate them.
   */
  async insertAcceptedDefinitionInTransaction(
    tx: Prisma.TransactionClient,
    definition: WorkItemTypeDefinitionDto,
    projectId: string,
    organizationId: OrganizationId,
    explicitId?: string,
  ): Promise<{ id: string; runPostCommit: () => Promise<void> }> {
    await this.assertCustomColorInTransaction(
      tx,
      definition.key,
      definition.colorKey,
    );
    const id = explicitId ?? uuidv4();
    const { capabilities, graphConfiguration } = splitWorkItemTypeCapabilities(
      definition.capabilities,
    );
    this.logger.log('Persisting accepted custom work-item type definition', {
      id,
      typeKey: definition.key,
      projectId,
      sectionCount: definition.sections.length,
    });

    await tx.workItemType.create({
      data: {
        id,
        typeKey: definition.key,
        projectId,
        lifecycleStatus: 'active',
        name: definition.name,
        role: definition.role,
        iconKey: definition.iconKey,
        colorKey: definition.colorKey,
        description: definition.description ?? null,
        sectionDefinitions:
          definition.sections as unknown as Prisma.InputJsonValue,
        allowedParentTypes: (definition.allowedParentTypes ??
          []) as unknown as Prisma.InputJsonValue,
        edgeTargets: (definition.edgeTargets ??
          []) as unknown as Prisma.InputJsonValue,
        allowedStatuses:
          definition.allowedStatuses as unknown as Prisma.InputJsonValue,
        requiredScalars: (definition.requiredScalars ??
          []) as unknown as Prisma.InputJsonValue,
        forbiddenScalars: (definition.forbiddenScalars ??
          []) as unknown as Prisma.InputJsonValue,
        parentage: {
          allowedParentEntityTypes: definition.allowedParentEntityTypes ?? [],
        } as unknown as Prisma.InputJsonValue,
        tracking: (definition.tracking ??
          NEUTRAL_TRACKING) as unknown as Prisma.InputJsonValue,
        agentSettableStatuses: (definition.agentSettableStatuses ??
          []) as unknown as Prisma.InputJsonValue,
        anchorableReportTypes: (definition.anchorableReportTypes ??
          []) as unknown as Prisma.InputJsonValue,
        agentGuidance:
          definition.agentGuidance === undefined
            ? Prisma.DbNull
            : (workItemTypeAgentGuidanceSchema.parse(
                definition.agentGuidance,
              ) as Prisma.InputJsonValue),
        maintenanceGuidance: definition.maintenanceGuidance ?? null,
        writingStandards: (definition.writingStandards ??
          EMPTY_WRITING_STANDARDS) as unknown as Prisma.InputJsonValue,
        acceptedConfigKinds: (definition.acceptedConfigKinds ??
          []) as unknown as Prisma.InputJsonValue,
        capabilities: capabilities as unknown as Prisma.InputJsonValue,
        graphConfiguration: (graphConfiguration ??
          Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      id,
      runPostCommit: async () => {
        await this.publishConfigChanged(
          organizationId,
          definition.key,
          projectId,
        );
      },
    };
  }

  /**
   * Replace an accepted custom type definition within the approval transaction.
   * The active/custom predicates make approval safe against a type being
   * archived or otherwise changed after proposal validation.
   */
  async updateAcceptedDefinitionInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    definition: WorkItemTypeDefinitionDto,
    projectId: string,
    organizationId: OrganizationId,
  ): Promise<{ runPostCommit: () => Promise<void> }> {
    await this.assertCustomColorInTransaction(tx, typeKey, definition.colorKey);
    const row = await tx.workItemType.findFirst({
      where: { typeKey, projectId },
    });
    if (!row) {
      const canonical = await tx.workItemTypeTemplate.findUnique({
        where: { typeKey },
      });
      if (!canonical) throw this.customDefinitionUnavailableError(typeKey);
      const created = await this.insertAcceptedDefinitionInTransaction(
        tx,
        definition,
        projectId,
        organizationId,
      );
      return { runPostCommit: created.runPostCommit };
    }
    const result = await tx.workItemType.updateMany({
      where: {
        id: row.id,
        lifecycleStatus: 'active',
      },
      data: this.definitionPersistenceData(definition),
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        `Active custom work-item type '${typeKey}' is no longer available in this project.`,
      );
    }

    return {
      runPostCommit: async () => {
        await this.publishConfigChanged(organizationId, typeKey, projectId);
      },
    };
  }

  /** Archive an accepted custom type and invalidate registry snapshots post-commit. */
  async archiveAcceptedDefinitionInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: string,
    organizationId: OrganizationId,
  ): Promise<{ runPostCommit: () => Promise<void> }> {
    const row = await this.requireActiveCustomDefinitionRow(
      tx,
      typeKey,
      projectId,
    );
    const result = await tx.workItemType.updateMany({
      where: {
        id: row.id,
        lifecycleStatus: 'active',
      },
      data: { lifecycleStatus: 'archived' },
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        `Active custom work-item type '${typeKey}' is no longer available in this project.`,
      );
    }

    return {
      runPostCommit: async () => {
        await this.publishConfigChanged(organizationId, typeKey, projectId);
      },
    };
  }

  /** Hard-delete an accepted project-owned custom type in the approval tx. */
  async deleteAcceptedCustomDefinitionInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: string,
    organizationId: OrganizationId,
  ): Promise<{ runPostCommit: () => Promise<void> }> {
    const row = await this.requireArchivedCustomDefinitionRow(
      tx,
      typeKey,
      projectId,
    );
    const result = await tx.workItemType.deleteMany({
      where: {
        id: row.id,
        projectId,
        lifecycleStatus: 'archived',
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        `Custom work-item type '${typeKey}' is no longer available in this project.`,
      );
    }

    return {
      runPostCommit: async () => {
        await this.publishConfigChanged(organizationId, typeKey, projectId);
      },
    };
  }

  async assertCustomDefinitionDeletableInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: string,
  ): Promise<void> {
    await this.requireArchivedCustomDefinitionRow(tx, typeKey, projectId);
  }

  /**
   * Read the current active custom definition from the approval transaction.
   * Approval reclassifies against this stored state instead of trusting the
   * state captured when the proposal was drafted.
   */
  async getAcceptedCustomDefinitionInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: string,
  ): Promise<WorkItemTypeSummaryDto> {
    const row = await this.requireActiveCustomDefinitionRow(
      tx,
      typeKey,
      projectId,
    );
    const definition = this.rowToDefinition(row);
    if (!definition) {
      throw new BadRequestException(
        `Custom work-item type '${typeKey}' has an invalid stored definition.`,
      );
    }
    const canonical = await tx.workItemTypeTemplate.findUnique({
      where: { typeKey },
    });
    return this.toSummary(
      row,
      definition,
      canonical
        ? WorkItemTypeEffectiveSource.CanonicalOverride
        : WorkItemTypeEffectiveSource.ProjectCustom,
    );
  }

  /**
   * Reconstruct the generated definition contract from a retained row. The
   * lifecycle owner uses this read-only mapping when validating restoration;
   * snapshot warming and invalidation remain owned by this registry.
   */
  materializeDefinition(
    row: WorkItemType | WorkItemTypeTemplate,
  ): WorkItemTypeDefinitionDto | null {
    return this.rowToDefinition(row);
  }

  private async requireActiveCustomDefinitionRow(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: string,
  ): Promise<WorkItemType> {
    const projectRow = await tx.workItemType.findFirst({
      where: { typeKey, projectId },
    });
    if (projectRow?.lifecycleStatus === 'active') {
      return projectRow;
    }
    if (projectRow) {
      throw this.customDefinitionUnavailableError(typeKey);
    }

    throw this.customDefinitionUnavailableError(typeKey);
  }

  private async requireArchivedCustomDefinitionRow(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: string,
  ): Promise<WorkItemType> {
    const projectRow = await tx.workItemType.findFirst({
      where: { typeKey, projectId },
    });
    const canonical = await tx.workItemTypeTemplate.findUnique({
      where: { typeKey },
      select: { id: true },
    });
    if (!canonical && projectRow?.lifecycleStatus === 'archived') {
      return projectRow;
    }
    throw new BadRequestException(
      `Archived custom work-item type '${typeKey}' is no longer available in this project.`,
    );
  }
  private customDefinitionUnavailableError(
    typeKey: string,
  ): BadRequestException {
    return new BadRequestException(
      `Active custom work-item type '${typeKey}' is no longer available in this project.`,
    );
  }

  private async assertCustomColorInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    colorKey: WorkItemColorKey | undefined,
  ): Promise<void> {
    if (colorKey === undefined) return;
    const canonical = await tx.workItemTypeTemplate.findUnique({
      where: { typeKey },
      select: { id: true },
    });
    if (canonical) {
      throw new BadRequestException(
        'Only project-custom work-item types may author colorKey.',
      );
    }
  }

  private definitionPersistenceData(
    definition: WorkItemTypeDefinitionDto,
  ): Prisma.WorkItemTypeUpdateManyMutationInput {
    const { capabilities, graphConfiguration } = splitWorkItemTypeCapabilities(
      definition.capabilities,
    );
    return {
      name: definition.name,
      role: definition.role,
      iconKey: definition.iconKey ?? null,
      colorKey: definition.colorKey ?? null,
      description: definition.description ?? null,
      sectionDefinitions:
        definition.sections as unknown as Prisma.InputJsonValue,
      allowedParentTypes: (definition.allowedParentTypes ??
        []) as unknown as Prisma.InputJsonValue,
      edgeTargets: (definition.edgeTargets ??
        []) as unknown as Prisma.InputJsonValue,
      allowedStatuses:
        definition.allowedStatuses as unknown as Prisma.InputJsonValue,
      requiredScalars: (definition.requiredScalars ??
        []) as unknown as Prisma.InputJsonValue,
      forbiddenScalars: (definition.forbiddenScalars ??
        []) as unknown as Prisma.InputJsonValue,
      parentage: {
        allowedParentEntityTypes: definition.allowedParentEntityTypes ?? [],
      } as unknown as Prisma.InputJsonValue,
      tracking: (definition.tracking ??
        NEUTRAL_TRACKING) as unknown as Prisma.InputJsonValue,
      agentSettableStatuses: (definition.agentSettableStatuses ??
        []) as unknown as Prisma.InputJsonValue,
      anchorableReportTypes: (definition.anchorableReportTypes ??
        []) as unknown as Prisma.InputJsonValue,
      agentGuidance:
        definition.agentGuidance === undefined
          ? Prisma.DbNull
          : (workItemTypeAgentGuidanceSchema.parse(
              definition.agentGuidance,
            ) as Prisma.InputJsonValue),
      maintenanceGuidance: definition.maintenanceGuidance ?? null,
      writingStandards: (definition.writingStandards ??
        EMPTY_WRITING_STANDARDS) as unknown as Prisma.InputJsonValue,
      acceptedConfigKinds: (definition.acceptedConfigKinds ??
        []) as unknown as Prisma.InputJsonValue,
      capabilities: capabilities as unknown as Prisma.InputJsonValue,
      graphConfiguration: (graphConfiguration ??
        Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
    };
  }

  materializeTemplateDefinition(
    template: WorkItemTypeTemplate,
  ): WorkItemTypeDefinitionDto {
    const parentage = template.parentage as unknown as {
      allowedParentEntityTypes?: EntityType[];
    };
    return {
      key: template.typeKey,
      name: template.name,
      role: template.role as WorkItemTypeRole,
      iconKey: (template.iconKey ?? undefined) as WorkItemIconKey | undefined,
      description: template.description,
      sections:
        template.sectionDefinitions as unknown as WorkItemTypeSectionDefinition[],
      requiredScalars:
        template.requiredScalars as unknown as WorkItemTypeScalarField[],
      forbiddenScalars:
        template.forbiddenScalars as unknown as WorkItemTypeScalarField[],
      allowedStatuses: template.allowedStatuses as unknown as WorkStatus[],
      allowedParentTypes: template.allowedParentTypes as unknown as string[],
      edgeTargets: template.edgeTargets as unknown as WorkItemTypeEdgeTarget[],
      allowedParentEntityTypes: parentage?.allowedParentEntityTypes ?? [],
      tracking: template.tracking as unknown as WorkItemTypeTracking,
      agentSettableStatuses:
        template.agentSettableStatuses as unknown as WorkStatus[],
      anchorableReportTypes:
        template.anchorableReportTypes as unknown as ReportType[],
      ...(template.agentGuidance == null
        ? {}
        : {
            agentGuidance: workItemTypeAgentGuidanceSchema.parse(
              template.agentGuidance,
            ),
          }),
      ...(template.maintenanceGuidance == null
        ? {}
        : { maintenanceGuidance: template.maintenanceGuidance }),
      writingStandards:
        template.writingStandards as unknown as WorkItemTypeWritingStandards,
      acceptedConfigKinds: (template.acceptedConfigKinds ??
        []) as unknown as WorkItemConfigKind[],
      capabilities: materializeWorkItemTypeCapabilities(
        template.capabilities,
        template.graphConfiguration,
      ),
    };
  }

  /**
   * Reconstruct the stored {@link WorkItemTypeDefinitionDto} from a row. Every
   * column maps to a definition field; `parentage` unwraps to the flat
   * `allowedParentEntityTypes`. A row whose definition columns are not populated
   * (no `name`) cannot be reconstructed, so it is skipped with a warning rather
   * than yielding a half-populated DTO.
   */
  private rowToDefinition(
    row: WorkItemType | WorkItemTypeTemplate,
  ): WorkItemTypeDefinitionDto | null {
    if (!row.name || !row.sectionDefinitions) {
      this.logger.warn(
        `Skipping work-item type '${row.typeKey}' (id ${row.id}): ` +
          `definition columns are not populated.`,
      );
      return null;
    }

    const parentage = row.parentage as unknown as {
      allowedParentEntityTypes?: EntityType[];
    };

    return {
      key: row.typeKey,
      name: row.name,
      role: row.role as WorkItemTypeRole,
      iconKey: (row.iconKey ?? undefined) as WorkItemIconKey | undefined,
      // Templates carry no color; only stored project types do.
      colorKey: ('colorKey' in row
        ? (row.colorKey ?? undefined)
        : undefined) as WorkItemColorKey | undefined,
      description: row.description,
      sections:
        row.sectionDefinitions as unknown as WorkItemTypeSectionDefinition[],
      requiredScalars:
        row.requiredScalars as unknown as WorkItemTypeScalarField[],
      forbiddenScalars:
        row.forbiddenScalars as unknown as WorkItemTypeScalarField[],
      allowedStatuses: row.allowedStatuses as unknown as WorkStatus[],
      allowedParentTypes: row.allowedParentTypes as unknown as string[],
      edgeTargets: row.edgeTargets as unknown as WorkItemTypeEdgeTarget[],
      allowedParentEntityTypes: parentage?.allowedParentEntityTypes ?? [],
      tracking: row.tracking as unknown as WorkItemTypeTracking,
      agentSettableStatuses:
        row.agentSettableStatuses as unknown as WorkStatus[],
      anchorableReportTypes:
        row.anchorableReportTypes as unknown as ReportType[],
      ...(row.agentGuidance == null
        ? {}
        : {
            agentGuidance: workItemTypeAgentGuidanceSchema.parse(
              row.agentGuidance,
            ),
          }),
      ...(row.maintenanceGuidance == null
        ? {}
        : { maintenanceGuidance: row.maintenanceGuidance }),
      writingStandards:
        row.writingStandards as unknown as WorkItemTypeWritingStandards,
      acceptedConfigKinds: (row.acceptedConfigKinds ??
        []) as unknown as WorkItemConfigKind[],
      capabilities: materializeWorkItemTypeCapabilities(
        row.capabilities,
        row.graphConfiguration,
      ),
    };
  }

  /** Wrap a reconstructed definition with the registry metadata the form reads. */
  private toSummary(
    row: WorkItemType,
    definition: WorkItemTypeDefinitionDto,
    effectiveSource: WorkItemTypeEffectiveSource,
  ): WorkItemTypeSummaryDto {
    return {
      id: row.id,
      definition,
      status:
        row.lifecycleStatus === 'active'
          ? WorkItemTypeLifecycleStatus.Active
          : WorkItemTypeLifecycleStatus.Archived,
      projectId: row.projectId as ProjectId,
      effectiveSource,
    };
  }

  /**
   * Resolve the effective rules for `typeKey` in `projectId`'s scope. A
   * project with no materialized row has no effective definition.
   */
  private findRules(
    typeKey: string,
    projectId: string,
  ): WorkItemTypeRules | undefined {
    return this.snapshot.projectRules.get(projectId)?.get(typeKey);
  }

  /** {@link findRules}, throwing a descriptive error on a miss. */
  private requireRules(typeKey: string, projectId: string): WorkItemTypeRules {
    const rules = this.findRules(typeKey, projectId);
    if (!rules) {
      throw new Error(
        `Work-item type '${typeKey}' is not present in the registry for ` +
          `project ${projectId}.`,
      );
    }
    return rules;
  }

  // --- Per-type accessors (read against the in-memory snapshot) ---

  /**
   * Rules for `typeKey` in a project's effective snapshot. This accessor
   * requires project scope and returns undefined on a miss. Lifecycle gating is the caller's
   * responsibility (see {@link assertTypeActive}).
   */
  getRulesForProject(
    typeKey: string,
    projectId: string,
  ): WorkItemTypeRules | undefined {
    return this.findRules(typeKey, projectId);
  }

  getAllowedStatuses(
    taskType: string,
    projectId: string,
  ): readonly WorkStatus[] {
    return this.requireRules(taskType, projectId).allowedStatuses;
  }

  getAgentSettableStatuses(
    taskType: string,
    projectId: string,
  ): readonly WorkStatus[] {
    return this.requireRules(taskType, projectId).agentSettableStatuses;
  }

  /**
   * Launch-config kinds explicitly accepted by the effective definition for a
   * project. Legacy rows with no policy resolve to an empty list.
   */
  getAcceptedConfigKinds(
    taskType: string,
    projectId: string,
  ): readonly WorkItemConfigKind[] {
    return this.requireRules(taskType, projectId).acceptedConfigKinds;
  }

  isConfigKindAccepted(
    taskType: string,
    configKind: WorkItemConfigKind,
    projectId: string,
  ): boolean {
    return this.getAcceptedConfigKinds(taskType, projectId).includes(
      configKind,
    );
  }

  getInitialStatusPolicy(
    taskType: string,
    projectId: string,
  ): InitialStatusPolicy {
    return this.requireRules(taskType, projectId).initialStatusPolicy;
  }

  isStatusAllowed(
    taskType: string,
    status: WorkStatus,
    projectId: string,
  ): boolean {
    return this.requireRules(taskType, projectId).allowedStatuses.includes(
      status,
    );
  }

  isSupersedable(taskType: string, projectId: string): boolean {
    return this.isStatusAllowed(taskType, WorkStatus.Superseded, projectId);
  }

  getSections(taskType: string, projectId: string): readonly string[] {
    return this.requireRules(taskType, projectId).sections;
  }

  getSectionDefinitions(
    taskType: string,
    projectId: string,
  ): readonly WorkItemTypeSectionDefinition[] {
    return this.requireRules(taskType, projectId).sectionDefinitions;
  }

  getSectionDefinition(
    taskType: string,
    key: string,
    projectId: string,
  ): WorkItemTypeSectionDefinition | undefined {
    return this.requireRules(taskType, projectId).sectionDefinitions.find(
      (section) => section.key === key,
    );
  }

  isSectionAllowed(taskType: string, key: string, projectId: string): boolean {
    return this.requireRules(taskType, projectId).sections.includes(key);
  }

  isScalarRequired(
    taskType: string,
    field: TaskScalarField,
    projectId: string,
  ): boolean {
    return this.requireRules(taskType, projectId).requiredScalars.includes(
      field,
    );
  }

  isScalarForbidden(
    taskType: string,
    field: TaskScalarField,
    projectId: string,
  ): boolean {
    return this.requireRules(taskType, projectId).forbiddenScalars.includes(
      field,
    );
  }

  isParentRequired(taskType: string, projectId: string): boolean {
    return this.requireRules(taskType, projectId).requiresParent;
  }

  rendersInline(typeKey: string, projectId: string): boolean {
    return this.requireRules(typeKey, projectId).rendersInline;
  }

  showsInExplorerSidebar(typeKey: string, projectId: string): boolean {
    return this.requireRules(typeKey, projectId).showsInExplorerSidebar;
  }

  getGraphCapability(
    typeKey: string,
    projectId: string,
  ): WorkItemTypeGraphCapability | null {
    return this.requireRules(typeKey, projectId).graph;
  }

  /**
   * Interpret projected topology using the effective project registry. The
   * relationship category comes from the graph declaration when available;
   * callers do not maintain a second workflow relationship registry.
   */
  getProjectedTopologySemantics(
    projectId: string,
    graphRootType: string,
  ): ProjectedTopologySemantics {
    const declarations =
      this.getGraphCapability(graphRootType, projectId)
        ?.readableRelationships ?? [];
    const categoryByEdgeType = new Map(
      declarations.map((declaration) => [
        declaration.edgeType,
        declaration.category,
      ]),
    );
    return {
      isFeature: (node) => node.type === WORK_ITEM_TYPE_KEYS.Feature,
      isWorkflow: (node) =>
        node.type === WORK_ITEM_TYPE_KEYS.Workflow ||
        node.type === WORK_ITEM_TYPE_KEYS.Diagram,
      isWorkflowStep: (node) =>
        node.type === WORK_ITEM_TYPE_KEYS.WorkflowStep ||
        node.type === WORK_ITEM_TYPE_KEYS.DiagramElement,
      isContract: (node) => node.type === WORK_ITEM_TYPE_KEYS.Contract,
      isFulfillment: (relationship) =>
        relationship.edgeType === 'FULFILLED_BY' &&
        (categoryByEdgeType.get(relationship.edgeType) ??
          relationship.category) === 'meta',
      isContractDependency: (relationship) =>
        relationship.edgeType === 'DEPENDS_ON' &&
        (categoryByEdgeType.get(relationship.edgeType) ??
          relationship.category) === 'meta',
      isFlow: (relationship) =>
        (categoryByEdgeType.get(relationship.edgeType) ??
          relationship.category) === 'flow',
    };
  }

  getGraphReadableRelationshipTypes(
    typeKey: string,
    projectId: string,
  ): readonly string[] {
    return (
      this.requireRules(typeKey, projectId).graph?.readableRelationships.map(
        (relationship) => relationship.edgeType,
      ) ?? []
    );
  }

  canParentChildType(
    parentType: string,
    childType: string,
    projectId: string,
  ): boolean {
    return (
      this.snapshot.projectRelationships
        .get(projectId)
        ?.canParentChildType(parentType, childType) ?? false
    );
  }

  canParentEntityType(
    childType: string,
    parentEntityType: EntityType,
    projectId: string,
  ): boolean {
    return (
      this.snapshot.projectRelationships
        .get(projectId)
        ?.canParentEntityType(childType, parentEntityType) ?? false
    );
  }

  getAllowedParentTypes(
    childType: string,
    projectId: string,
  ): readonly string[] {
    return (
      this.snapshot.projectRelationships
        .get(projectId)
        ?.getAllowedParentTypes(childType) ?? []
    );
  }

  getAllowedChildTypes(
    parentType: string,
    projectId: string,
  ): readonly string[] {
    return (
      this.snapshot.projectRelationships
        .get(projectId)
        ?.getAllowedChildTypes(parentType) ?? []
    );
  }

  /**
   * Whether a type participates in the FEATURE hierarchy for a project.
   * Hierarchy participation is a protected canonical-identity axis: a custom
   * type cannot opt into the structural tree by setting its own capability.
   * The project's Feature row still has to be present and active.
   * Unknown keys resolve to `false` because callers classify arbitrary task
   * rows and need a boolean rather than a throw.
   */
  isHierarchyNode(taskType: string, projectId: string): boolean {
    return (
      taskType === WORK_ITEM_TYPE_KEYS.Feature &&
      this.isTypeActiveForProject(taskType, projectId)
    );
  }

  /** Active, project-owned types that retain protected hierarchy semantics. */
  getHierarchyNodeTypes(projectId: string): string[] {
    return this.getActiveTypeKeys(projectId).filter((typeKey) =>
      this.isHierarchyNode(typeKey, projectId),
    );
  }

  getWritingStandards(
    taskType: string,
    projectId: string,
  ): WorkItemTypeWritingStandards {
    return this.requireRules(taskType, projectId).writingStandards;
  }

  getTrackingRules(taskType: string, projectId: string): TrackingRules {
    return this.requireRules(taskType, projectId).tracking;
  }

  isTrackingSource(taskType: string, projectId: string): boolean {
    return this.getTrackingSourceTypes(projectId).includes(taskType);
  }

  /** Tracking-source types from one project's active effective snapshot. */
  getTrackingSourceTypes(projectId: string): string[] {
    return [
      ...(this.snapshot.projectRelationships
        .get(projectId)
        ?.getTrackingSourceTypes() ?? []),
    ];
  }

  isTrackingSourceAllowed(
    targetType: string,
    sourceEntityType: EntityType,
    sourceTaskType: string | undefined,
    projectId: string,
  ): boolean {
    return (
      this.snapshot.projectRelationships
        .get(projectId)
        ?.isTrackingSourceAllowed(
          targetType,
          sourceEntityType,
          sourceTaskType,
        ) ?? false
    );
  }

  /** @deprecated Use target-specific isTrackingSourceAllowed. */
  isTrackingTargetEntityTypeAllowed(
    sourceType: string,
    targetEntityType: EntityType,
    projectId: string,
  ): boolean {
    return (
      targetEntityType === EntityType.Task &&
      this.getTrackingTargetTaskTypes(sourceType, projectId).length > 0
    );
  }

  isTrackingTargetTaskTypeAllowed(
    sourceType: string,
    targetTaskType: string,
    projectId: string,
  ): boolean {
    return this.isTrackingSourceAllowed(
      targetTaskType,
      EntityType.Task,
      sourceType,
      projectId,
    );
  }

  getTrackingTargetTaskTypes(
    sourceType: string,
    projectId: string,
  ): readonly string[] {
    return [
      ...(this.snapshot.projectRelationships
        .get(projectId)
        ?.getTrackingTargetTaskTypes(sourceType) ?? []),
    ];
  }

  buildTrackingEligibilityIndex(projectId: string): TrackingEligibilityIndex {
    return (
      this.snapshot.projectRelationships
        .get(projectId)
        ?.getTrackingEligibilityIndex() ?? {
        allowedSourcesByTargetTaskType: new Map(),
        allowedSourceTaskTypesBySourceTaskType: new Map(),
      }
    );
  }

  /** Allowed-status sets for active definitions in one project's snapshot. */
  getAllowedStatusEntries(projectId: string): {
    taskType: WorkItemTypeKey;
    allowedStatuses: WorkStatus[];
  }[] {
    return this.getActiveTypeKeys(projectId).flatMap((typeKey) => {
      const rules = this.findRules(typeKey, projectId);
      return rules
        ? [
            {
              taskType: typeKey as WorkItemTypeKey,
              allowedStatuses: [...rules.allowedStatuses],
            },
          ]
        : [];
    });
  }

  /**
   * Ordered refinement levels for `typeKey` in `projectId`'s scope, derived
   * from the type's section set rather than a hardcoded type list. A missing
   * project-owned definition is an error; the registry must not silently
   * substitute a canonical profile for an incomplete snapshot.
   */
  getTaskRefinementLevels(
    typeKey: string,
    projectId: string,
  ): TaskRefinementLevel[] {
    const sectionKeys = this.resolveRefinementSectionKeys(typeKey, projectId);
    return CANONICAL_REFINEMENT_LEVELS.filter((level) =>
      sectionKeys.includes(level),
    );
  }

  private resolveRefinementSectionKeys(
    typeKey: string,
    projectId: string,
  ): readonly string[] {
    return this.requireRules(typeKey, projectId).sections;
  }

  // --- Project-scoped type validation ---

  /**
   * True when `typeKey` is usable in `projectId`'s effective snapshot right
   * now. There is no global fallback outside the project-owned snapshot.
   */
  isTypeActiveForProject(typeKey: string, projectId: string): boolean {
    return (
      this.snapshot.projectTypeActivity.get(projectId)?.get(typeKey) ===
      'active'
    );
  }

  /**
   * Sorted list of all type keys that are active in `projectId`'s effective
   * snapshot. A project with no materialized rows returns an empty list.
   */
  getActiveTypeKeys(projectId: string): string[] {
    const keys = new Set<string>();
    const projectMap = this.snapshot.projectTypeActivity.get(projectId);
    if (projectMap) {
      for (const [typeKey, status] of projectMap) {
        if (status === 'active') {
          keys.add(typeKey);
        } else {
          keys.delete(typeKey);
        }
      }
    }
    return [...keys].sort();
  }

  // --- Project-scoped definition reads (back the /work-item-types endpoints) ---

  /**
   * Type summaries visible in `projectId`'s scope: only this project's own
   * materialized definitions. Each summary is the public
   * `WorkItemTypeSummaryDto` (full definition plus lifecycle and provenance).
   * Sync against the warmed snapshot, sorted by type key so the list order is
   * stable across instances. Pass `status` to filter to a single lifecycle
   * status; omit it to return both active and archived, mirroring the list
   * endpoint's optional `status` query parameter.
   */
  getDefinitions(
    projectId: string,
    status?: WorkItemTypeLifecycleStatus,
  ): WorkItemTypeSummaryDto[] {
    const projectSummaries =
      this.snapshot.projectSummaries.get(projectId) ?? [];
    const summaries = projectSummaries.filter(
      (summary) => status === undefined || summary.status === status,
    );
    summaries.sort((a, b) => a.definition.key.localeCompare(b.definition.key));
    this.logger.debug(
      `Serving ${summaries.length} work-item type definitions for project ` +
        `${projectId}${status ? ` (status ${status})` : ''}`,
    );
    return summaries;
  }

  /**
   * Single type summary for `typeKey` in `projectId`'s scope, regardless of
   * lifecycle status, or undefined when no such type is visible to the
   * project. Reads the same warmed snapshot as {@link getDefinitions}.
   */
  getDefinition(
    projectId: string,
    typeKey: string,
  ): WorkItemTypeSummaryDto | undefined {
    return (this.snapshot.projectSummaries.get(projectId) ?? []).find(
      (summary) => summary.definition.key === typeKey,
    );
  }

  /** Both keys resolve against this captured effective snapshot; never merge axes. */
  getGuidance(
    projectId: string,
    typeKey: string,
    focalTypeKey?: string,
    purpose?: typeof WorkItemTypeGuidancePurpose.Semantic,
  ): WorkItemTypeGuidanceDto;
  getGuidance(
    projectId: string,
    typeKey: string,
    focalTypeKey: string | undefined,
    purpose: typeof WorkItemTypeGuidancePurpose.Maintenance,
  ): WorkItemTypeMaintenanceGuidanceDto;
  getGuidance(
    projectId: string,
    typeKey: string,
    focalTypeKey: string | undefined,
    purpose: WorkItemTypeGuidancePurpose | undefined,
  ): WorkItemTypeGuidanceDto | WorkItemTypeMaintenanceGuidanceDto;
  getGuidance(
    projectId: string,
    typeKey: string,
    focalTypeKey?: string,
    purpose: WorkItemTypeGuidancePurpose = WorkItemTypeGuidancePurpose.Semantic,
  ): WorkItemTypeGuidanceDto | WorkItemTypeMaintenanceGuidanceDto {
    const summaries = this.snapshot.projectSummaries.get(projectId) ?? [];
    return this.projectGuidance(summaries, typeKey, focalTypeKey, purpose);
  }

  /** Resolve the complete bounded request against one captured snapshot. */
  getGuidanceBatch(
    projectId: string,
    request: WorkItemTypeGuidanceBatchRequestDto,
  ): WorkItemTypeGuidanceBatchDto {
    const snapshot = this.snapshot;
    const summaries = snapshot.projectSummaries.get(projectId) ?? [];
    return {
      results: request.typeKeys.map((typeKey) =>
        this.projectGuidance(
          summaries,
          typeKey,
          request.focalTypeKey,
          request.purpose,
        ),
      ),
    };
  }

  private projectGuidance(
    summaries: WorkItemTypeSummaryDto[],
    typeKey: string,
    focalTypeKey?: string,
    purpose: WorkItemTypeGuidancePurpose = WorkItemTypeGuidancePurpose.Semantic,
  ): WorkItemTypeGuidanceDto | WorkItemTypeMaintenanceGuidanceDto {
    const requireActive = (key: string) => {
      const summary = summaries.find((entry) => entry.definition.key === key);
      if (!summary || summary.status !== WorkItemTypeLifecycleStatus.Active) {
        throw new NotFoundException(
          `Work-item type '${key}' was not found or is unavailable in this project.`,
        );
      }
      return summary.definition;
    };
    const definition = requireActive(typeKey);
    if (purpose === WorkItemTypeGuidancePurpose.Maintenance) {
      return {
        typeKey: definition.key,
        name: definition.name,
        ...(definition.maintenanceGuidance === undefined
          ? {}
          : { maintenanceGuidance: definition.maintenanceGuidance }),
      };
    }
    if (focalTypeKey !== undefined) requireActive(focalTypeKey);
    const guide = definition.agentGuidance;
    if (!guide) {
      throw new NotFoundException(
        `Semantic guidance for work-item type '${typeKey}' is unavailable in this project.`,
      );
    }
    const examples = (items: typeof guide.examples) =>
      (items ?? []).map(({ title, guidance }) => ({ title, guidance }));
    const contextualGuidance =
      focalTypeKey === undefined
        ? []
        : (guide.contexts ?? [])
            .filter((context) => context.focalTypeKeys.includes(focalTypeKey))
            .map((context) => ({
              guidance: context.guidance,
              examples: examples(context.examples),
            }));
    return {
      typeKey: definition.key,
      name: definition.name,
      overview: guide.overview,
      examples: examples(guide.examples),
      ...(contextualGuidance.length ? { contextualGuidance } : {}),
    };
  }

  /**
   * Asserts that `typeKey` is active for `projectId`. Throws a
   * BadRequestException naming all valid active types when the key is absent
   * or archived, so creation and re-parent paths produce identical error text.
   */
  assertTypeActive(typeKey: string, projectId: string): void {
    if (!this.isTypeActiveForProject(typeKey, projectId)) {
      const validTypes = this.getActiveTypeKeys(projectId);
      throw new BadRequestException(
        `'${typeKey}' is not a usable type for this project. ` +
          `Valid types: ${validTypes.join(', ')}`,
      );
    }
  }
}
