import { extractOrganizationIdFromToken } from '../../auth/index';
import { Configuration, ProjectMaturity, ProjectsApi } from '../../shared/api/index';

/** Reads the project's maturity stage; throws when the response lacks a valid stage. */
export const readProjectMaturity = async (
  accessToken: string,
  projectId: string,
): Promise<ProjectMaturity> => {
  const organizationId = extractOrganizationIdFromToken(accessToken);
  if (!organizationId)
    throw new Error('Cannot read project context: no organization id in the access token.');
  const configured = process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev';
  const basePath = configured.endsWith('/api/v1')
    ? configured
    : `${configured.replace(/\/$/u, '')}/api/v1`;
  const api = new ProjectsApi(new Configuration({ accessToken, basePath }));
  const response = await api.findOneProject({ organizationId, projectId });
  const project = response.data.data;
  if (!project || !Object.values(ProjectMaturity).includes(project.maturity)) {
    throw new Error(
      'Cannot start session: project response is missing the required maturity stage.',
    );
  }
  return project.maturity;
};
