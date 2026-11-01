import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { captureRetainedOriginalTargetContent } from '../proposal/proposal-original-content';

export type EvalOutputStamp = {
  ragEnabled: boolean;
  applicationEligible: boolean;
};

export type EvalOutputAdmission = EvalOutputStamp & { isEvalOutput: boolean };

export const ORDINARY_EVAL_OUTPUT_STAMP: EvalOutputAdmission = {
  ragEnabled: true,
  applicationEligible: true,
  isEvalOutput: false,
};

@Injectable()
export class EvalOutputAdmissionService {
  constructor(
    @Optional() private readonly workItemTypes?: WorkItemTypeRegistryService,
  ) {}

  /**
   * Persist the writer's independent retrieval and application properties.
   * Session identity and attempt lifecycle never classify output.
   */
  async resolve(
    tx: AnyTransactionClient,
    params: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      writingSessionId?: string | null;
      ragEnabled?: boolean;
      applicationEligible?: boolean;
    },
  ): Promise<EvalOutputAdmission> {
    return {
      ragEnabled: params.ragEnabled ?? true,
      applicationEligible: params.applicationEligible ?? true,
      isEvalOutput:
        params.ragEnabled === false || params.applicationEligible === false,
    };
  }

  /**
   * Admits a proposal written by an eval target. Besides the stamp, it
   * returns the proposal columns that keep the proposal readable but inert:
   * out of ingestion and application, with the target's original content
   * captured now so the diff survives later edits to the target.
   */
  async resolveProposal(
    tx: AnyTransactionClient,
    params: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      writingSessionId?: string | null;
      proposal: {
        action: string;
        targetEntityType: string;
        targetEntityId: string;
        updates: unknown;
        ragEnabled?: boolean;
        applicationEligible?: boolean;
      };
    },
  ): Promise<{
    stamp: EvalOutputAdmission;
    data: Partial<Prisma.ProposalUncheckedCreateInput>;
  }> {
    const stamp = await this.resolve(tx, { ...params, ...params.proposal });
    if (!stamp.isEvalOutput) {
      return { stamp, data: {} };
    }
    const definition =
      params.proposal.targetEntityType === 'WORK_ITEM_TYPE'
        ? this.workItemTypes?.getDefinition(
            params.projectId,
            params.proposal.targetEntityId,
          )?.definition
        : undefined;
    const retained = definition
      ? { definition }
      : await captureRetainedOriginalTargetContent(tx, params.proposal);
    return {
      stamp,
      data: {
        ragEnabled: stamp.ragEnabled,
        applicationEligible: stamp.applicationEligible,
        retainedOriginalTargetContent: retained
          ? (retained as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    };
  }
}
