import { Injectable, Logger } from '@nestjs/common';
import type {
  PhaseBreakdownCompletionPayload,
  PhaseBreakdownPlan,
  PhaseBreakdownStep,
  PlanSubmissionAdmissionFinding,
  PlanSubmissionAdmissionRequest,
  PlanSubmissionAdmissionResponse,
  StepReviewCompletionPayload,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, PlanId, ProjectId, UserId } from 'src/types';
import { WorkItemChangeSetProjectorService } from '../proposal/work-item-change-set-projector.service';
import { workItemChangeSetValidationRequestSchema } from '../proposal/work-item-change-set.schema';
import {
  phaseBreakdownCompletionPayloadSchema,
  planSubmissionAdmissionRequestSchema,
  stepReviewCompletionPayloadSchema,
} from '../../flows/nodes/plan-shaping/schemas';

type AccumulatedPhases = Record<number, Record<number, PhaseBreakdownPlan>>;

export type AcceptedPlanPreparation = {
  accumulatedPhases: AccumulatedPhases;
  submission: PhaseBreakdownCompletionPayload | StepReviewCompletionPayload;
  changeSet: WorkItemChangeSetValidationRequest;
  advisories: PlanSubmissionAdmissionFinding[];
};

const finding = (
  field: string,
  code: string,
  reason: string,
  correction?: string,
): PlanSubmissionAdmissionFinding => ({
  field,
  code,
  reason,
  ...(correction ? { correction } : {}),
});

@Injectable()
export class PlanSubmissionAdmissionService {
  private readonly logger = new Logger(PlanSubmissionAdmissionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly projector: WorkItemChangeSetProjectorService,
  ) {}

  async admit(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    planId: PlanId;
    userId: UserId;
    request: PlanSubmissionAdmissionRequest;
  }): Promise<PlanSubmissionAdmissionResponse> {
    const parsedRequest = planSubmissionAdmissionRequestSchema.safeParse(
      params.request,
    );
    if (!parsedRequest.success) {
      return {
        status: 'rejected',
        advisories: [],
        findings: parsedRequest.error.issues.map((issue) =>
          finding(
            `/${issue.path.map(String).join('/')}`,
            issue.code,
            issue.message,
            'Correct this field and retry the same submission.',
          ),
        ),
      };
    }
    const request = parsedRequest.data;
    const [plan, conversation, trigger, messages] = await Promise.all([
      this.prisma.db.task.findFirst({
        where: {
          id: params.planId,
          organizationId: params.organizationId,
          projectId: params.projectId,
          type: 'PLAN',
          archivedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.db.conversation.findFirst({
        where: {
          id: request.conversationId,
          organizationId: params.organizationId,
          projectId: params.projectId,
          workflowName: 'plan-from-design-doc',
          workflowAboutId: params.planId,
          status: { not: 'DELETED' },
          agentSessions: {
            some: {
              organizationId: params.organizationId,
              projectId: params.projectId,
              userId: params.userId,
              type: 'PLAN_GENERATION',
            },
          },
        },
        select: { id: true },
      }),
      this.prisma.db.message.findFirst({
        where: {
          id: request.triggerMessageId,
          conversationId: request.conversationId,
          projectId: params.projectId,
        },
        select: { data: true },
      }),
      this.prisma.db.message.findMany({
        where: {
          conversationId: request.conversationId,
          projectId: params.projectId,
          type: 'SYSTEM',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { data: true },
      }),
    ]);

    if (!plan || !conversation || !trigger) {
      return {
        status: 'conflict',
        findings: [
          finding(
            '/triggerMessageId',
            'admission_context_changed',
            'The Plan, conversation, or active trigger no longer matches this submission.',
            'Reload the active Plan-generation prompt and retry its current submission.',
          ),
        ],
      };
    }

    const triggerData = trigger.data as Record<string, unknown>;
    const triggersAgent = triggerData['triggersAgent'] as
      | { promptType?: unknown; nodeId?: unknown; payload?: unknown }
      | undefined;
    const expectedPrompt =
      request.kind === 'phase_breakdown'
        ? 'plan_shaping_phase_breakdown'
        : 'plan_shaping_step_review';
    const expectedNode =
      request.kind === 'phase_breakdown'
        ? 'plan-shaping-phase-breakdown'
        : 'plan-shaping-step-review';
    if (
      triggersAgent?.promptType !== expectedPrompt ||
      triggersAgent.nodeId !== expectedNode
    ) {
      return {
        status: 'conflict',
        findings: [
          finding(
            '/kind',
            'trigger_mismatch',
            'The submission kind does not match the active Plan-generation trigger.',
            'Use the submission tool exposed by the current prompt.',
          ),
        ],
      };
    }

    const triggerPayload = triggersAgent.payload as Record<string, unknown>;
    if (triggerPayload['planId'] !== params.planId) {
      return {
        status: 'conflict',
        findings: [
          finding(
            '/triggerMessageId',
            'plan_mismatch',
            'The active trigger belongs to a different Plan.',
          ),
        ],
      };
    }

    const alreadyCompleted = messages.some((message) => {
      const data = message.data as Record<string, unknown>;
      const completion = data['completesExternalAgentNode'] as
        | { completesTriggerMessageId?: unknown }
        | undefined;
      return completion?.completesTriggerMessageId === request.triggerMessageId;
    });
    if (alreadyCompleted) {
      return {
        status: 'conflict',
        findings: [
          finding(
            '/triggerMessageId',
            'trigger_already_completed',
            'The active trigger was completed while this submission was being admitted.',
            'Reload the current Plan-generation prompt.',
          ),
        ],
      };
    }

    const accumulated = this.reconstructAccumulatedPhases(messages);
    const expectedStageId = this.expectedStageId(
      request.kind,
      triggerPayload,
      messages,
    );
    const prepared = await this.prepare({
      organizationId: params.organizationId,
      projectId: params.projectId,
      planId: params.planId,
      kind: request.kind,
      submission: request.submission,
      accumulatedPhases: accumulated,
      expectedStageId,
      expectedStageIdx: triggerPayload['stageIdx'],
      expectedPhaseIdx: triggerPayload['phaseIdx'],
    });
    if ('findings' in prepared) {
      return {
        status: 'rejected',
        findings: prepared.findings,
        advisories: prepared.advisories,
      };
    }
    return {
      status: 'accepted',
      submission: prepared.submission,
      advisories: prepared.advisories,
    };
  }

  async prepare(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    planId: PlanId;
    kind: 'phase_breakdown' | 'step_review';
    submission: unknown;
    accumulatedPhases: AccumulatedPhases;
    expectedStageId?: string;
    expectedStageIdx?: unknown;
    expectedPhaseIdx?: unknown;
  }): Promise<
    | AcceptedPlanPreparation
    | {
        findings: PlanSubmissionAdmissionFinding[];
        advisories: PlanSubmissionAdmissionFinding[];
      }
  > {
    const parsed =
      params.kind === 'phase_breakdown'
        ? phaseBreakdownCompletionPayloadSchema.safeParse(params.submission)
        : stepReviewCompletionPayloadSchema.safeParse(params.submission);
    if (!parsed.success) {
      return {
        advisories: [],
        findings: parsed.error.issues.map((issue) =>
          finding(
            `/${issue.path.map(String).join('/')}`,
            issue.code,
            issue.message,
            'Correct this field and retry the same submission.',
          ),
        ),
      };
    }

    const submission = this.normalizeSubmission(parsed.data);
    const cursorFindings: PlanSubmissionAdmissionFinding[] = [];
    if (submission.stageIdx !== params.expectedStageIdx) {
      cursorFindings.push(
        finding(
          '/stageIdx',
          'stage_idx_mismatch',
          'stageIdx does not match the active cursor.',
        ),
      );
    }
    if (
      params.kind === 'phase_breakdown' &&
      'phaseIdx' in submission &&
      submission.phaseIdx !== params.expectedPhaseIdx
    ) {
      cursorFindings.push(
        finding(
          '/phaseIdx',
          'phase_idx_mismatch',
          'phaseIdx does not match the active cursor.',
        ),
      );
    }
    submission.plan.steps.forEach((step, index) => {
      if (params.expectedStageId && step.stageId !== params.expectedStageId) {
        cursorFindings.push(
          finding(
            `/submission/plan/steps/${index}/stageId`,
            'wrong_active_stage',
            'The step is not bound to the stage for the active cursor.',
          ),
        );
      }
    });
    if (cursorFindings.length)
      return { findings: cursorFindings, advisories: [] };

    const normalized = await this.normalizeServiceAssignments(
      params.organizationId,
      params.projectId,
      submission,
    );
    // Copy only the maps we replace; retained plans are read-only during projection.
    const candidate = { ...params.accumulatedPhases };
    if (params.kind === 'phase_breakdown') {
      const phaseSubmission =
        normalized.submission as PhaseBreakdownCompletionPayload;
      candidate[phaseSubmission.stageIdx] = {
        ...params.accumulatedPhases[phaseSubmission.stageIdx],
        [phaseSubmission.phaseIdx]: phaseSubmission.plan,
      };
    } else {
      candidate[normalized.submission.stageIdx] = {
        0: normalized.submission.plan,
      };
    }

    const prepared = await this.prepareAccumulated({
      organizationId: params.organizationId,
      projectId: params.projectId,
      planId: params.planId,
      accumulatedPhases: candidate,
      serviceAssignmentsNormalized: true,
    });
    if ('findings' in prepared) {
      return {
        findings: prepared.findings,
        advisories: [...normalized.advisories, ...prepared.advisories],
      };
    }
    return {
      accumulatedPhases: candidate,
      submission: normalized.submission,
      changeSet: prepared.changeSet,
      advisories: [...normalized.advisories, ...prepared.advisories],
    };
  }

  async prepareAccumulated(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    planId: PlanId;
    accumulatedPhases: AccumulatedPhases;
    serviceAssignmentsNormalized?: boolean;
  }): Promise<
    | {
        changeSet: WorkItemChangeSetValidationRequest;
        advisories: PlanSubmissionAdmissionFinding[];
      }
    | {
        findings: PlanSubmissionAdmissionFinding[];
        advisories: PlanSubmissionAdmissionFinding[];
      }
  > {
    const normalized = params.serviceAssignmentsNormalized
      ? { accumulatedPhases: params.accumulatedPhases, advisories: [] }
      : await this.normalizeAccumulatedServiceAssignments(
          params.organizationId,
          params.projectId,
          params.accumulatedPhases,
        );
    const changeSet = this.buildChangeSet(
      params.planId,
      normalized.accumulatedPhases,
    );
    const request =
      workItemChangeSetValidationRequestSchema.safeParse(changeSet);
    if (!request.success) {
      return {
        advisories: normalized.advisories,
        findings: request.error.issues.map((issue) =>
          finding(issue.path.join('.'), issue.code, issue.message),
        ),
      };
    }
    const projection = await this.projector.project({
      organizationId: params.organizationId,
      projectId: params.projectId,
      request: request.data,
    });
    const findings = projection.issues.map((issue) => ({
      ...issue,
      correction: issue.suggestion,
    }));
    this.logger.debug('Plan projected admission completed', {
      planId: params.planId,
      findingCount: findings.length,
      findings,
    });
    if (findings.length) {
      return {
        findings,
        advisories: normalized.advisories,
      };
    }
    return {
      changeSet: request.data,
      advisories: normalized.advisories,
    };
  }

  buildChangeSet(
    planId: PlanId,
    accumulatedPhases: AccumulatedPhases,
  ): WorkItemChangeSetValidationRequest {
    const operations: WorkItemChangeSetValidationRequest['operations'] = [];
    for (const step of this.allSteps(accumulatedPhases)) {
      const ref = {
        refType: 'temporary' as const,
        tempId: `journey-task:${step.id}`,
      };
      operations.push({
        op: 'workItem.create',
        ref,
        name: step.title,
        type: 'STANDARD',
        parent: { refType: 'existing', id: step.stageId },
        ...(step.serviceIds !== undefined
          ? { serviceIds: step.serviceIds }
          : {}),
      });
      operations.push({
        op: 'section.replace',
        ref,
        key: 'description',
        content: `${step.description}\n\n## Implementation\n\n${step.implementation}`,
      });
      operations.push({
        op: 'section.replace',
        ref,
        key: 'acceptanceCriteria',
        content: step.acceptanceCriteria,
      });
    }
    // Keep repeated declarations distinct so shared projection detects duplicate endpoints.
    for (const step of this.allSteps(accumulatedPhases)) {
      for (const [index, prerequisiteId] of (
        step.dependsOnStepIds ?? []
      ).entries()) {
        operations.push({
          op: 'relationship.create',
          ref: {
            refType: 'temporary',
            tempId: `journey-dependency:${step.id}:${prerequisiteId}:${index}`,
          },
          source: { refType: 'temporary', tempId: `journey-task:${step.id}` },
          target: {
            refType: 'temporary',
            tempId: `journey-task:${prerequisiteId}`,
          },
          edgeType: 'DEPENDS_ON',
          category: 'meta',
        });
      }
    }
    this.logger.debug('Plan dependency change set built', {
      planId,
      operationCount: operations.length,
      dependencyCount: operations.filter(
        (operation) => operation.op === 'relationship.create',
      ).length,
    });
    return { root: { refType: 'existing', id: planId }, operations };
  }

  private reconstructAccumulatedPhases(
    messages: Array<{ data: unknown }>,
  ): AccumulatedPhases {
    const accumulated: AccumulatedPhases = {};
    for (const message of messages) {
      const data = message.data as Record<string, unknown>;
      const completion = data['completesExternalAgentNode'] as
        | { nodeId?: unknown; action?: unknown; payload?: unknown }
        | undefined;
      if (!completion) continue;
      if (
        completion.nodeId === 'plan-shaping-phase-breakdown' &&
        completion.action === 'DONE'
      ) {
        const parsed = phaseBreakdownCompletionPayloadSchema.safeParse(
          completion.payload,
        );
        if (!parsed.success) continue;
        accumulated[parsed.data.stageIdx] ??= {};
        accumulated[parsed.data.stageIdx]![parsed.data.phaseIdx] =
          parsed.data.plan;
      }
      if (
        completion.nodeId === 'plan-shaping-step-review' &&
        completion.action === 'STEP_REVIEW_DONE'
      ) {
        const parsed = stepReviewCompletionPayloadSchema.safeParse(
          completion.payload,
        );
        if (!parsed.success) continue;
        accumulated[parsed.data.stageIdx] = { 0: parsed.data.plan };
      }
    }
    return accumulated;
  }

  private expectedStageId(
    kind: 'phase_breakdown' | 'step_review',
    trigger: Record<string, unknown>,
    messages: Array<{ data: unknown }>,
  ): string | undefined {
    if (kind === 'phase_breakdown') {
      const journeyStep = trigger['journeyStep'] as
        | { stageId?: unknown }
        | undefined;
      return typeof journeyStep?.stageId === 'string'
        ? journeyStep.stageId
        : undefined;
    }
    const stageIdx = trigger['stageIdx'];
    if (typeof stageIdx === 'number') {
      let stageIds: string[] = [];
      for (const message of messages) {
        const data = message.data as Record<string, unknown>;
        const completion = data['completesExternalAgentNode'] as
          | { nodeId?: unknown; action?: unknown; payload?: unknown }
          | undefined;
        if (
          completion?.nodeId !== 'plan-shaping-journey-map' ||
          completion.action !== 'APPROVED'
        ) {
          continue;
        }
        const payload = completion.payload as
          | { journeyMap?: { steps?: unknown } }
          | undefined;
        if (!Array.isArray(payload?.journeyMap?.steps)) continue;
        stageIds = [
          ...new Set(
            payload.journeyMap.steps.flatMap((step) => {
              const stageId = (step as { stageId?: unknown }).stageId;
              return typeof stageId === 'string' ? [stageId] : [];
            }),
          ),
        ];
      }
      if (stageIds[stageIdx]) return stageIds[stageIdx];
    }

    // Legacy persisted triggers did not carry the stage identity separately.
    // A non-empty drafted set still gives an authoritative binding for those runs.
    const steps = trigger['steps'];
    if (!Array.isArray(steps) || steps.length === 0) return undefined;
    const stageId = (steps[0] as { stageId?: unknown }).stageId;
    return typeof stageId === 'string' ? stageId : undefined;
  }

  private normalizeSubmission<
    T extends PhaseBreakdownCompletionPayload | StepReviewCompletionPayload,
  >(submission: T): T {
    const steps = [...submission.plan.steps]
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
      .map((step, sequenceOrder) => ({
        ...step,
        title: step.title.trim(),
        description: step.description.trim(),
        implementation: step.implementation.trim(),
        acceptanceCriteria: step.acceptanceCriteria.trim(),
        designDocMotivation: step.designDocMotivation.trim(),
        sequenceOrder,
        ...(step.serviceIds !== undefined
          ? { serviceIds: [...step.serviceIds] }
          : {}),
      }));
    return { ...submission, plan: { steps } } as T;
  }

  private async normalizeServiceAssignments<
    T extends PhaseBreakdownCompletionPayload | StepReviewCompletionPayload,
  >(
    organizationId: OrganizationId,
    projectId: ProjectId,
    submission: T,
  ): Promise<{ submission: T; advisories: PlanSubmissionAdmissionFinding[] }> {
    const requested = [
      ...new Set(
        submission.plan.steps.flatMap((step) => step.serviceIds ?? []),
      ),
    ];
    const services = requested.length
      ? await this.prisma.db.service.findMany({
          where: {
            id: { in: requested },
            organizationId,
            projectId,
            status: 'ACTIVE',
            archivedAt: null,
          },
          select: { id: true },
        })
      : [];
    const valid = new Set(services.map((service) => service.id));
    const advisories: PlanSubmissionAdmissionFinding[] = [];
    const steps = submission.plan.steps.map((step, index) => {
      const field = `/submission/plan/steps/${index}/serviceIds`;
      if (step.serviceIds === undefined) {
        advisories.push(
          finding(
            field,
            'missing_service_coverage',
            'No Service assignment was supplied. Add the complete known project Service scope when it can be resolved.',
          ),
        );
        return step;
      }
      if (step.serviceIds.length === 0) {
        advisories.push(
          finding(
            field,
            'empty_service_coverage',
            'The Service assignment array is empty. Add the complete known project Service scope when it can be resolved.',
          ),
        );
      }
      const repeated = [
        ...new Set(
          step.serviceIds.filter(
            (id, position) => step.serviceIds!.indexOf(id) !== position,
          ),
        ),
      ];
      if (repeated.length) {
        advisories.push(
          finding(
            field,
            'duplicate_service_reference',
            `Repeated Service IDs are preserved through persistence and assigned once: ${repeated.join(', ')}.`,
          ),
        );
      }
      const serviceIds = step.serviceIds?.filter((id) => valid.has(id));
      const invalid = step.serviceIds?.filter((id) => !valid.has(id)) ?? [];
      if (invalid.length) {
        advisories.push(
          finding(
            field,
            'service_assignment_omitted',
            `Inactive or out-of-project Service assignments were omitted: ${[
              ...new Set(invalid),
            ].join(', ')}. Select active Services from this project.`,
          ),
        );
      }
      return {
        ...step,
        ...(step.serviceIds !== undefined ? { serviceIds } : {}),
      };
    });
    return { submission: { ...submission, plan: { steps } } as T, advisories };
  }

  private async normalizeAccumulatedServiceAssignments(
    organizationId: OrganizationId,
    projectId: ProjectId,
    accumulatedPhases: AccumulatedPhases,
  ): Promise<{
    accumulatedPhases: AccumulatedPhases;
    advisories: PlanSubmissionAdmissionFinding[];
  }> {
    const accumulated: AccumulatedPhases = {};
    const advisories: PlanSubmissionAdmissionFinding[] = [];
    for (const stageIdx of Object.keys(accumulatedPhases).map(Number)) {
      accumulated[stageIdx] = {};
      for (const phaseIdx of Object.keys(accumulatedPhases[stageIdx] ?? {}).map(
        Number,
      )) {
        const plan = accumulatedPhases[stageIdx]![phaseIdx]!;
        const normalized = await this.normalizeServiceAssignments(
          organizationId,
          projectId,
          {
            stageIdx,
            phaseIdx,
            plan,
          } as PhaseBreakdownCompletionPayload,
        );
        accumulated[stageIdx]![phaseIdx] = normalized.submission.plan;
        advisories.push(...normalized.advisories);
      }
    }
    return { accumulatedPhases: accumulated, advisories };
  }

  private allSteps(accumulated: AccumulatedPhases): PhaseBreakdownStep[] {
    return Object.keys(accumulated)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((stageIdx) =>
        Object.keys(accumulated[stageIdx] ?? {})
          .map(Number)
          .sort((a, b) => a - b)
          .flatMap((phaseIdx) => accumulated[stageIdx]![phaseIdx]!.steps),
      );
  }
}
