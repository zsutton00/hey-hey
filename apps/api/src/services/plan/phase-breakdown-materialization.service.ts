import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
} from '@prisma/client';
import type { Proposal } from '@prisma/client';
import type {
  PhaseBreakdownPlan,
  PhaseBreakdownStep,
} from 'src/generated/local';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import {
  ConversationId,
  OrganizationId,
  PlanId,
  ProjectId,
  UserId,
} from 'src/types';
import { buildOriginInfluence } from '../proposal/origin-influence';
import { ProposalApprovalService } from '../proposal/proposal-approval.service';
import { PlanSubmissionAdmissionService } from './plan-submission-admission.service';

type JsonObject = Record<string, Prisma.InputJsonValue>;

@Injectable()
export class PhaseBreakdownMaterializationService {
  private readonly logger = new Logger(
    PhaseBreakdownMaterializationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalService: ProposalApprovalService,
    private readonly admissionService: PlanSubmissionAdmissionService,
  ) {}

  async materializeAccumulatedPhases(params: {
    accumulatedPhases: Record<number, Record<number, PhaseBreakdownPlan>>;
    planId: PlanId;
    designDocId: string;
    conversationId: ConversationId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
  }): Promise<{ materializedStepIds: string[] }> {
    const diagnosticContext = {
      planId: params.planId,
      conversationId: params.conversationId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      designDocId: params.designDocId,
    };
    let checkpoint = 'collect_steps';
    let proposalId: string | undefined;
    this.logger.log('Plan materialization started', diagnosticContext);
    try {
      for (const [stageIndex, phases] of Object.entries(
        params.accumulatedPhases,
      )) {
        for (const [phaseIndex, phase] of Object.entries(phases)) {
          for (const [stepIndex, step] of phase.steps.entries()) {
            this.logger.debug('Plan materialization input step', {
              ...diagnosticContext,
              stageIndex,
              phaseIndex,
              stepIndex,
              stepId: step.id,
              stageId: step.stageId,
              sequenceOrder: step.sequenceOrder,
              serviceCount: step.serviceIds?.length ?? 0,
            });
            step.serviceIds?.forEach((serviceId, serviceIndex) => {
              this.logger.debug('Plan materialization input Service', {
                ...diagnosticContext,
                stepId: step.id,
                serviceIndex,
                serviceId,
              });
            });
          }
        }
      }
      const stepsByStageId = this.collectStepsByStage(params.accumulatedPhases);
      if (stepsByStageId.size === 0) {
        this.logger.warn(
          'materializeAccumulatedPhases called with no tasks to materialize',
          { planId: params.planId },
        );
        return { materializedStepIds: [] };
      }

      const stepIds = [...stepsByStageId.values()]
        .flat()
        .map((step) => step.id);
      if (new Set(stepIds).size !== stepIds.length) {
        throw new BadRequestException(
          'phase-breakdown materialization contains duplicate Task handles',
        );
      }

      checkpoint = 'load_stages';
      const stages = await this.prisma.db.task.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          parentTaskId: params.planId,
          type: 'PLAN_STAGE',
          archivedAt: null,
        },
        select: { id: true },
      });
      this.logger.debug('Plan canonical stages loaded', {
        ...diagnosticContext,
        stageCount: stages.length,
      });
      for (const stage of stages) {
        this.logger.debug('Plan canonical stage', {
          ...diagnosticContext,
          stageId: stage.id,
        });
      }
      const validStageIds = new Set<string>(stages.map((stage) => stage.id));
      const unknownStageIds = [...stepsByStageId.keys()].filter(
        (stageId) => !validStageIds.has(stageId),
      );
      if (unknownStageIds.length > 0) {
        for (const stageId of unknownStageIds) {
          this.logger.error('Plan materialization stage rejected', {
            ...diagnosticContext,
            stageId,
            reason: 'outside_canonical_plan',
            canonicalStageCount: stages.length,
          });
        }
        throw new BadRequestException(
          `phase-breakdown materialization references Stages outside canonical Plan ${params.planId}: ${unknownStageIds.join(', ')}`,
        );
      }

      checkpoint = 'validate_change_set';
      const preparation = await this.admissionService.prepareAccumulated({
        organizationId: params.organizationId,
        projectId: params.projectId,
        planId: params.planId,
        accumulatedPhases: params.accumulatedPhases,
      });
      for (const advisory of preparation.advisories) {
        this.logger.warn('Plan Service coverage advisory', {
          ...diagnosticContext,
          advisoryPath: advisory.field,
          advisoryCode: advisory.code,
          advisoryMessage: advisory.reason,
          advisoryCorrection: advisory.correction,
        });
      }
      if ('findings' in preparation) {
        for (const issue of preparation.findings) {
          this.logger.error('Plan materialization validation issue', {
            ...diagnosticContext,
            issuePath: issue.field,
            issueCode: issue.code,
            issueMessage: issue.reason,
          });
        }
        throw new BadRequestException({
          message: 'Invalid phase-breakdown Work Item change set',
          issues: preparation.findings,
        });
      }
      const updates = preparation.changeSet as unknown as JsonObject;

      checkpoint = 'project_change_set';
      // Project before the transaction so the projector's Graph and pooled
      // reads never pin the transaction connection.
      const prepared = await this.approvalService.projectGenericPreparation(
        params.organizationId,
        params.projectId,
        preparation.changeSet,
      );

      checkpoint = 'prepare_transaction';
      await this.prisma.db.$transaction(async (tx) => {
        checkpoint = 'find_or_create_proposal';
        const proposal = await this.findOrCreateProposalInTx(tx, {
          updates,
          ...params,
        });
        proposalId = proposal.id;
        this.logger.log('Plan materialization proposal selected', {
          ...diagnosticContext,
          proposalId,
          status: proposal.status,
        });
        checkpoint = 'queue_intent';
        await this.approvalService.queueGenericWorkItemChangeSetInTransaction(
          tx,
          proposal,
          params.organizationId,
          params.projectId,
          prepared,
        );
      });

      this.logger.log('Plan materialization preparation committed', {
        ...diagnosticContext,
        proposalId,
      });
      if (!proposalId) {
        throw new Error('phase-breakdown materialization did not prepare');
      }
      checkpoint = 'materialize_intent';
      await this.approvalService.materializeGenericWorkItemChangeSet({
        proposalId,
        organizationId: params.organizationId,
        projectId: params.projectId,
      });

      checkpoint = 'reload_publication';
      const materialization =
        await this.prisma.db.workItemChangeSetMaterialization.findUnique({
          where: { proposalId },
          select: { workItemIdMappings: true, status: true },
        });
      this.logger.debug('Plan materialization publication reloaded', {
        ...diagnosticContext,
        proposalId,
        found: Boolean(materialization),
        status: materialization?.status,
      });
      if (!materialization || materialization.status !== 'PUBLISHED') {
        throw new Error(
          `phase-breakdown Work Item change set ${proposalId} was not published`,
        );
      }
      checkpoint = 'resolve_task_mappings';
      const mappings = materialization.workItemIdMappings as Record<
        string,
        string
      >;
      const materializedStepIds = stepIds.map((stepId) => {
        const taskId = mappings[`temporary:journey-task:${stepId}`];
        if (!taskId) {
          throw new Error(
            `phase-breakdown materialization omitted Task identity for ${stepId}`,
          );
        }
        this.logger.debug('Plan materialized Task identity resolved', {
          ...diagnosticContext,
          proposalId,
          stepId,
          taskId,
        });
        return taskId;
      });

      this.logger.log(
        'phase-breakdown canonical Task materialization complete',
        {
          planId: params.planId,
          conversationId: params.conversationId,
          taskCount: materializedStepIds.length,
          stageCount: stepsByStageId.size,
        },
      );
      return { materializedStepIds };
    } catch (error) {
      this.logger.error('Plan materialization failed', {
        ...diagnosticContext,
        proposalId,
        checkpoint,
        includeErrorDetails: true,
        error,
      });
      throw error;
    }
  }

  private collectStepsByStage(
    accumulatedPhases: Record<number, Record<number, PhaseBreakdownPlan>>,
  ): Map<string, PhaseBreakdownStep[]> {
    const stepsByStageId = new Map<string, PhaseBreakdownStep[]>();
    for (const stageIdx of Object.keys(accumulatedPhases)
      .map(Number)
      .sort((left, right) => left - right)) {
      const phases = accumulatedPhases[stageIdx]!;
      for (const phaseIdx of Object.keys(phases)
        .map(Number)
        .sort((left, right) => left - right)) {
        for (const step of [...phases[phaseIdx]!.steps].sort(
          (left, right) => left.sequenceOrder - right.sequenceOrder,
        )) {
          const existing = stepsByStageId.get(step.stageId) ?? [];
          existing.push(step);
          stepsByStageId.set(step.stageId, existing);
        }
      }
    }
    return stepsByStageId;
  }

  private async findOrCreateProposalInTx(
    tx: AnyTransactionClient,
    params: {
      updates: JsonObject;
      planId: PlanId;
      designDocId: string;
      conversationId: ConversationId;
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
    },
  ): Promise<Proposal> {
    const proposalDelegate = (tx as Prisma.TransactionClient).proposal;
    const existing = await proposalDelegate.findFirst({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        conversationId: params.conversationId,
        type: ProposalType.BATCH,
        action: ProposalAction.UPDATE,
        targetEntityId: params.planId,
        targetEntityType: TargetEntityType.TASK,
        status: { in: [ProposalStatus.DRAFT, ProposalStatus.APPROVED] },
        updates: { equals: params.updates as Prisma.InputJsonValue },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      this.logger.log(
        'Resuming reviewed Plan Task materialization from existing proposal',
        {
          proposalId: existing.id,
          conversationId: params.conversationId,
          status: existing.status,
        },
      );
      return existing;
    }

    const origin = await buildOriginInfluence(tx, params.conversationId);
    const influences: Prisma.InputJsonValue[] = [
      {
        entityId: params.designDocId,
        entityType: 'DESIGN_DOC',
        reasoning:
          'Canonical implementation Tasks were derived from the reviewed design document and user journey.',
        reasonType: 'derived',
      },
      ...(origin ? [origin as unknown as Prisma.InputJsonValue] : []),
    ];
    return proposalDelegate.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        type: ProposalType.BATCH,
        action: ProposalAction.UPDATE,
        targetEntityId: params.planId,
        targetEntityType: TargetEntityType.TASK,
        updates: params.updates,
        title: 'Materialize reviewed Plan Tasks',
        requestorId: params.userId,
        requestorContext: {
          userId: params.userId,
          organizationId: params.organizationId,
          toolName: 'phase_breakdown_materialization',
          timestamp: new Date().toISOString(),
          source: 'agent',
          conversationId: params.conversationId,
        },
        influences,
        edges: Prisma.JsonNull,
        conversationId: params.conversationId,
        status: ProposalStatus.DRAFT,
      },
    });
  }
}
