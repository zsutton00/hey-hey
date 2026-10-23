import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ControllerBindingOriginGuard } from '../../common/guards/controller-binding-origin.guard';
import { ControllerAuthorizationController } from '../controller-authorization.controller';
import { OrganizationId, ProjectId, UserId } from '../../types';

describe('ControllerAuthorizationController', () => {
  const organizationId =
    '11111111-1111-4111-8111-111111111111' as OrganizationId;
  const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
  const userId = '33333333-3333-4333-8333-333333333333' as UserId;
  const request = { cookies: { hey_hey_controller_binding: 'binding-secret' } };
  const response = { cookie: jest.fn() };
  const body: any = { machineId: 'machine', action: {} };

  it('requires both JWT authentication and organization membership', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ControllerAuthorizationController),
    ).toEqual([JwtAuthGuard, OrganizationGuard, ProjectAccessGuard, ControllerBindingOriginGuard]);
  });

  it('binds the generated resolve operation to its concrete POST route', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, ControllerAuthorizationController),
    ).toBe(
      'api/v1/organizations/:organizationId/projects/:projectId/controller-authorizations',
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ControllerAuthorizationController.prototype.resolve,
      ),
    ).toBe('resolve');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ControllerAuthorizationController.prototype.resolve,
      ),
    ).toBe(RequestMethod.POST);
  });

  it('passes only authenticated path context and generated request data', async () => {
    const service = {
      resolve: jest
        .fn()
        .mockResolvedValue({ outcome: 'AUTHORIZATION_REQUIRED' }),
      prepare: jest.fn().mockResolvedValue({ intent: {}, publicKey: {} }),
      submit: jest.fn().mockResolvedValue({ outcome: 'DENIED' }),
    };
    const cookieService = {
      read: jest.fn().mockReturnValue('binding-secret'),
      set: jest.fn(),
    };
    const controller = new ControllerAuthorizationController(
      service as any,
      cookieService as any,
    );

    await controller.resolve(
      organizationId,
      projectId,
      userId,
      request as any,
      body,
    );
    await controller.prepare(
      organizationId,
      projectId,
      userId,
      request as any,
      body,
    );
    await controller.submit(
      organizationId,
      projectId,
      userId,
      body,
      response as any,
    );

    expect(service.resolve).toHaveBeenCalledWith({
      organizationId,
      projectId,
      userId,
      controllerBindingSecret: 'binding-secret',
      input: body,
    });
    expect(service.prepare).toHaveBeenCalledWith({
      organizationId,
      projectId,
      userId,
      controllerBindingSecret: 'binding-secret',
      input: body,
    });
    expect(service.submit).toHaveBeenCalledWith({
      organizationId,
      projectId,
      userId,
      input: body,
    });
  });
});
