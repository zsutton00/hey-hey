import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EntityType } from '../../generated/model/entityType';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';

export interface WorkItemParentageCandidate {
  childType: string;
  parentEntityType: EntityType | null;
  parentType: string | null;
  projectId: string;
}

export interface WorkItemParentageViolation {
  code:
    | 'parent_required'
    | 'parent_entity_type_incompatible'
    | 'parent_type_incompatible';
  reason: string;
}

@Injectable()
export class WorkItemParentageValidator {
  private readonly logger = new Logger(WorkItemParentageValidator.name);

  constructor(
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  evaluate(
    candidate: WorkItemParentageCandidate,
  ): WorkItemParentageViolation | null {
    const { childType, parentEntityType, parentType, projectId } = candidate;
    this.logger.debug('Checking runtime work-item parentage state', {
      childType,
      parentEntityType,
      parentType,
      projectId,
    });
    this.workItemTypeRegistry.assertTypeActive(childType, projectId);

    if (parentEntityType === null && parentType === null) {
      return this.workItemTypeRegistry.isParentRequired(childType, projectId)
        ? {
            code: 'parent_required',
            reason: `${childType} items require a structural parent under the configured work-item type definition.`,
          }
        : null;
    }

    if (parentEntityType === null) {
      return {
        code: 'parent_entity_type_incompatible',
        reason: `A structural parent for ${childType} must include its EntityType.`,
      };
    }

    const parentEntityTypeIsAllowed =
      this.workItemTypeRegistry.canParentEntityType(
        childType,
        parentEntityType,
        projectId,
      );
    if (!parentEntityTypeIsAllowed) {
      return {
        code: 'parent_entity_type_incompatible',
        reason: `A ${parentEntityType} entity cannot parent a ${childType} item under the configured work-item type definitions.`,
      };
    }

    if (parentEntityType !== EntityType.Task) return null;

    if (parentType === null) {
      return {
        code: 'parent_type_incompatible',
        reason: `A Task parent for ${childType} must include its work-item subtype.`,
      };
    }

    this.workItemTypeRegistry.assertTypeActive(parentType, projectId);

    const pairIsAllowed = this.workItemTypeRegistry.canParentChildType(
      parentType,
      childType,
      projectId,
    );
    this.logger.debug('Resolved runtime work-item parentage state', {
      childType,
      parentEntityType,
      parentType,
      projectId,
      pairIsAllowed,
    });

    if (!pairIsAllowed) {
      return {
        code: 'parent_type_incompatible',
        reason: `A ${parentType} item cannot parent a ${childType} item under the configured work-item type definitions.`,
      };
    }

    return null;
  }

  assertValid(candidate: WorkItemParentageCandidate): void {
    const violation = this.evaluate(candidate);
    if (violation) {
      throw new BadRequestException(violation.reason);
    }
  }
}
