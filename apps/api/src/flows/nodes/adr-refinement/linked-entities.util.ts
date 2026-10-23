import { Logger } from '@nestjs/common';
import { TaskSummarySchema } from 'src/flows/utils/shared-schemas';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { TaskService } from 'src/services/tasks/task.service';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import type {
  InitiativeSummary,
  TaskSummary,
} from 'src/flows/utils/shared-schemas';
import type { DesignDocLinkResponseDto } from 'src/generated/model/designDocLinkResponseDto';
import { TaskSummaryTaskTypeEnum } from 'src/generated/agents/models/TaskSummary';
import type { DesignDocId } from 'src/types/design-doc.types';
import type { OrganizationId } from 'src/types';

type LinkEntity = Pick<DesignDocLinkResponseDto, 'entityType' | 'entityId'>;

const logger = new Logger('AdrLinkedEntityHelper');

export interface AdrLinkedEntityContext {
  initiative?: InitiativeSummary;
  task?: TaskSummary;
}

const requireField = (value: string | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing required field: ${label}`);
  }
  return value;
};

interface AdrLinkedEntityParams {
  designDocId: DesignDocId;
  organizationId: OrganizationId;
  designDocService: DesignDocService;
  taskService: TaskService;
  links?: LinkEntity[];
}

export async function loadAdrLinkedEntities({
  designDocId,
  organizationId,
  designDocService,
  taskService,
  links: providedLinks,
}: AdrLinkedEntityParams): Promise<AdrLinkedEntityContext> {
  const links =
    providedLinks ??
    (await designDocService.getLinks(designDocId, organizationId));

  const context: AdrLinkedEntityContext = {};

  const taskLink = links.find((link) => link.entityType === 'task');
  if (taskLink) {
    try {
      const task = await taskService.findOneForAdapter(
        taskLink.entityId,
        organizationId,
      );
      if (task) {
        const content = materializedSectionsToContentMap(task.sections);
        context.task = TaskSummarySchema.parse({
          taskType:
            task.type === 'BUG'
              ? TaskSummaryTaskTypeEnum.BUG
              : TaskSummaryTaskTypeEnum.STANDARD,
          title: task.name || 'Untitled Task',
          description: requireField(content.description, 'task.description'),
          acceptanceCriteria:
            task.type === 'BUG'
              ? undefined
              : requireField(
                  content.acceptanceCriteria,
                  'task.acceptanceCriteria',
                ),
        });
      }
    } catch (error) {
      logger.warn('Failed to load linked task for ADR', {
        designDocId,
        organizationId,
        taskId: taskLink.entityId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return context;
}
