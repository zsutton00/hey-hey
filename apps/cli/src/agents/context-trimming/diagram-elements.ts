import {
  Configuration,
  TaskSortBy,
  TaskSortDir,
  TasksApi,
  WorkStatus,
} from '../../shared/api/generated';
import type { DiagramElementText } from '../../jev/scenarios';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';

const ELEMENT_TYPE = 'DIAGRAM_ELEMENT';
const PAGE_LIMIT = 500;

interface DiagramElementsRequest {
  organizationId: string;
  projectId: string;
  diagramId: string;
}

/**
 * A Diagram's live elements, in the order they were drawn, with the description each one
 * carries. The elements hold most of what a Diagram covers, so Jev reads them with it.
 */
export const readDiagramElements = async (
  request: DiagramElementsRequest,
  deps: Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl'>,
): Promise<DiagramElementText[]> => {
  const accessToken = await deps.auth.getAccessToken();
  const client = new TasksApi(new Configuration({ accessToken, basePath: deps.apiBaseUrl }));
  const response = await client.organizationsOrganizationIdProjectsProjectIdTasksGet({
    organizationId: request.organizationId,
    projectId: request.projectId,
    parentTaskId: request.diagramId,
    type: ELEMENT_TYPE,
    includeSectionKeys: ['description'],
    sortBy: TaskSortBy.CreatedAt,
    sortDir: TaskSortDir.Asc,
    limit: PAGE_LIMIT,
  });
  const elements = response.data.data ?? [];
  if (elements.length === PAGE_LIMIT) {
    throw new Error(`Diagram ${request.diagramId} has at least ${String(PAGE_LIMIT)} elements.`);
  }
  return elements
    .filter((element) => element.status !== WorkStatus.Archived && !element.archivedAt)
    .map((element) => ({
      name: element.name,
      description:
        element.sections
          ?.find((section) => section.key === 'description')
          ?.materializedMarkdown.trim() ?? '',
    }));
};
