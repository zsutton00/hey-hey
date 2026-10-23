import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectAccessGuard, ProjectResourceId } from '../project-access.guard';
import { ProjectAccessService } from '../../services/project-access.service';

@ProjectResourceId('project')
class ProjectController {}
@ProjectResourceId('task')
class TaskController {}

describe('ProjectAccessGuard', () => {
  const access = new ProjectAccessService({} as never);
  const assertProject = jest.spyOn(access, 'assertProject');
  const guard = new ProjectAccessGuard(access, new Reflector());
  function context(
    params: object,
    controller = TaskController,
    userId = 'alice',
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId },
          params: { organizationId: 'org', ...params },
          body: {
            agentSessionIds: ['missing', 'foreign'],
            projectId: 'other',
            updates: { parentTaskId: 'missing' },
            targetEntityType: 'TASK',
            targetEntityId: 'missing',
          },
          query: { parentTaskId: 'missing', conversationId: 'foreign' },
          headers: { 'x-agent-session-id': 'missing', 'x-project-id': 'other' },
        }),
      }),
      getHandler: () => function handler() {},
      getClass: () => controller,
    } as unknown as ExecutionContext;
  }
  beforeEach(() => {
    jest.resetAllMocks();
    assertProject.mockResolvedValue();
  });

  it('checks route membership once without resolving entity references', async () => {
    await expect(
      guard.canActivate(
        context({
          projectId: 'project',
          taskId: 'missing',
          suggestionId: 'missing',
          entityType: 'TASK',
          entityId: 'missing',
        }),
      ),
    ).resolves.toBe(true);
    expect(assertProject).toHaveBeenCalledTimes(1);
    expect(assertProject).toHaveBeenCalledWith('alice', 'org', 'project');
  });
  it('denies a nonmember', async () => {
    assertProject.mockRejectedValue(new ForbiddenException());
    await expect(
      guard.canActivate(context({ projectId: 'project' })),
    ).rejects.toThrow(ForbiddenException);
  });
  it('authorizes the id parameter on project routes', async () => {
    await guard.canActivate(context({ id: 'project' }, ProjectController));
    expect(assertProject).toHaveBeenCalledWith('alice', 'org', 'project');
  });
  it('does not resolve child-only routes to projects', async () => {
    await expect(
      guard.canActivate(context({ id: 'missing', taskId: 'missing' })),
    ).resolves.toBe(true);
    expect(assertProject).not.toHaveBeenCalled();
  });
  it('requires an authenticated user', async () => {
    await expect(
      guard.canActivate(context({ projectId: 'project' }, TaskController, '')),
    ).rejects.toThrow(ForbiddenException);
    expect(assertProject).not.toHaveBeenCalled();
  });
  it('requires an organization', async () => {
    await expect(
      guard.canActivate(
        context({ projectId: 'project', organizationId: undefined }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(assertProject).not.toHaveBeenCalled();
  });
});
