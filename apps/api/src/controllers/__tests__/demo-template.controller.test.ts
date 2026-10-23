import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { DemoSandboxProgramService } from '../../services/demo-sandbox/demo-sandbox-program.service';
import type { DemoTemplateService } from '../../services/demo-sandbox/demo-template.service';
import { DemoTemplateController } from '../demo-template.controller';
import { SetDemoTemplatePipe } from '../demo-template.validation';

describe('demo template HTTP boundary', () => {
  const pipe = new SetDemoTemplatePipe();
  const valid = {
    projectId: 'ac41a491-6eb2-48ce-82e8-489897ca63ec',
    repositoryUrl: 'https://github.com/example/template',
  };

  it('requires authentication and platform admin access', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DemoTemplateController),
    ).toEqual([JwtAuthGuard, AdminGuard]);
  });

  it.each([valid, { ...valid, repositoryUrl: `${valid.repositoryUrl}.git/` }])(
    'accepts the OpenAPI request shape',
    (value) => {
      expect(pipe.transform(value)).toBe(value);
    },
  );

  it.each([
    null,
    {},
    { ...valid, projectId: 'invalid' },
    { ...valid, repositoryUrl: 'https://gitlab.com/example/template' },
    { ...valid, repositoryUrl: 'https://github.com/example/template/issues' },
    {
      ...valid,
      repositoryUrl: 'https://user:secret@github.com/example/template',
    },
    { ...valid, repositoryUrl: 'http://github.com/example/template' },
    { ...valid, active: true },
  ])('rejects a contract-invalid request', (value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });
});

describe('demo sandbox admin overview', () => {
  const program = {
    enabled: true,
    activeCap: 10,
    perIpLimit: 2,
    perIpWindowSeconds: 3600,
  };
  const template = {
    id: '620720fe-117a-4d69-bbc9-24d174cc9c22',
    projectId: 'ac41a491-6eb2-48ce-82e8-489897ca63ec',
    repositoryUrl: 'https://github.com/example/template',
    active: true,
    createdAt: '2026-10-16T00:00:00.000Z',
  };

  function controllerWith(activeTemplate: typeof template | null) {
    const templates = {
      getActive: jest.fn().mockResolvedValue(activeTemplate),
    };
    const programService = {
      get: jest.fn().mockResolvedValue(program),
      countActiveSandboxes: jest.fn().mockResolvedValue(3),
    };
    return new DemoTemplateController(
      templates as unknown as DemoTemplateService,
      programService as unknown as DemoSandboxProgramService,
    );
  }

  it('is served by GET on the guarded admin collection path', () => {
    const handler = Object.getOwnPropertyDescriptor(
      DemoTemplateController.prototype,
      'getOverview',
    )?.value as object;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
  });

  it('returns program, active template and active count', async () => {
    await expect(controllerWith(template).getOverview()).resolves.toEqual({
      program,
      template,
      activeCount: 3,
    });
  });

  it('returns a null template when none is designated', async () => {
    await expect(controllerWith(null).getOverview()).resolves.toEqual({
      program,
      template: null,
      activeCount: 3,
    });
  });
});
