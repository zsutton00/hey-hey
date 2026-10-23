import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsApi } from '../../shared/api/index';
import { readProjectMaturity } from './project-session-context';
vi.mock('../../auth/index', () => ({
  extractOrganizationIdFromToken: vi.fn(() => 'organization'),
}));
const findOneProject = vi.spyOn(ProjectsApi.prototype, 'findOneProject');

describe('project maturity read', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['TAKING_SHAPE', 'ESTABLISHED'] as const)(
    'reads the current %s stage in organization scope',
    async (maturity) => {
      findOneProject.mockResolvedValueOnce({ data: { data: { maturity } } } as never);
      await expect(readProjectMaturity('token', 'project')).resolves.toBe(maturity);
      expect(findOneProject).toHaveBeenCalledWith({
        organizationId: 'organization',
        projectId: 'project',
      });
    },
  );
  it('fails at the session boundary if the project response omits the stage', async () => {
    findOneProject.mockResolvedValueOnce({ data: { data: {} } } as never);
    await expect(readProjectMaturity('token', 'project')).rejects.toThrow(
      'required maturity stage',
    );
  });
  it('fails at the session boundary if the project response carries an unknown stage', async () => {
    findOneProject.mockResolvedValueOnce({ data: { data: { maturity: 'DRIFTING' } } } as never);
    await expect(readProjectMaturity('token', 'project')).rejects.toThrow(
      'required maturity stage',
    );
  });
  it('keeps project read failures scoped to the caller', async () => {
    findOneProject.mockRejectedValueOnce(new Error('Project unavailable'));
    await expect(readProjectMaturity('token', 'project')).rejects.toThrow('Project unavailable');
  });
});
