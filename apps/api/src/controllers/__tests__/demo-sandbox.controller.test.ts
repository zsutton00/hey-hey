import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { DemoSandboxController } from '../demo-sandbox.controller';
import {
  DemoSandboxProgramPipe,
  ProvisionDemoSandboxPipe,
} from '../demo-sandbox.validation';
import { DEMO_BINDING_COOKIE_NAME } from '../../services/demo-sandbox/demo-sandbox.constants';

const sandbox = {
  organizationId: 'org-1',
  projectId: 'project-1',
  expiresAt: '2026-10-17T02:00:00.000Z',
  inactivityTimeoutSeconds: 7200,
  repositoryUrl: 'https://github.com/example/template',
  resumed: false,
};
const session = {
  response: { accessToken: 'access', expiresIn: 900 },
  refreshSecret: 'refresh',
};
const request = (cookies: Record<string, string> = {}) =>
  ({ cookies, ip: '203.0.113.9', headers: { 'user-agent': 'jest' } }) as never;
const response = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });

const handlers = DemoSandboxController.prototype as unknown as Record<
  'provision' | 'resume' | 'current' | 'availability',
  object
>;

describe('DemoSandboxController', () => {
  const admission = {
    provision: jest.fn(),
    resume: jest.fn(),
    current: jest.fn(),
  };
  const controller = new DemoSandboxController(admission as never);
  const body = {
    botCheckToken: 't',
    demoTermsVersion: 'demo-1.0',
    agentBridgeAcknowledgmentVersion: 'demo-1.0',
  };

  beforeEach(() => jest.resetAllMocks());

  it('keeps provision, resume and availability public and current authenticated', () => {
    const isPublic = (
      method: 'provision' | 'resume' | 'current' | 'availability',
    ) =>
      Reflect.getMetadata(IS_PUBLIC_KEY, handlers[method]) as
        | boolean
        | undefined;
    expect(isPublic('provision')).toBe(true);
    expect(isPublic('resume')).toBe(true);
    expect(isPublic('availability')).toBe(true);
    expect(isPublic('current')).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, handlers.current)).toEqual([
      JwtAuthGuard,
    ]);
  });

  it.each([
    ['staging', true],
    ['development', true],
    ['production', false],
  ])(
    'offers the demo by deployment environment alone (%s)',
    (environment, available) => {
      const previous = process.env.DEPLOYMENT_ENVIRONMENT;
      process.env.DEPLOYMENT_ENVIRONMENT = environment;
      try {
        expect(controller.availability()).toEqual({ available });
      } finally {
        process.env.DEPLOYMENT_ENVIRONMENT = previous;
      }
    },
  );

  it('passes the browser-binding cookie, address and session metadata to admission', async () => {
    admission.provision.mockResolvedValue({ sandbox, session });

    await controller.provision(
      body,
      request({ [DEMO_BINDING_COOKIE_NAME]: 'secret' }),
      response() as never,
    );

    expect(admission.provision).toHaveBeenCalledWith(body, {
      bindingSecret: 'secret',
      ipAddress: '203.0.113.9',
      sessionMetadata: { ipAddress: '203.0.113.9', userAgent: 'jest' },
    });
  });

  it('sets session and binding cookies only after a sandbox is admitted', async () => {
    admission.provision.mockResolvedValue({
      sandbox,
      session,
      bindingSecret: 'new-secret',
    });
    const res = response();

    await expect(
      controller.provision(body, request(), res as never),
    ).resolves.toBe(sandbox);

    expect(res.cookie).toHaveBeenCalledWith(
      DEMO_BINDING_COOKIE_NAME,
      'new-secret',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'refresh',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('publishes no cookie when admission is refused', async () => {
    admission.provision.mockRejectedValue(new Error('PROVISIONING_FAILED'));
    const res = response();

    await expect(
      controller.provision(body, request(), res as never),
    ).rejects.toThrow('PROVISIONING_FAILED');
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('resumes with a fresh session but leaves the existing binding cookie alone', async () => {
    admission.resume.mockResolvedValue({
      sandbox: { ...sandbox, resumed: true },
      session,
    });
    const res = response();

    await expect(
      controller.resume(
        request({ [DEMO_BINDING_COOKIE_NAME]: 's' }),
        res as never,
      ),
    ).resolves.toMatchObject({ resumed: true });

    expect(res.cookie).not.toHaveBeenCalledWith(
      DEMO_BINDING_COOKIE_NAME,
      expect.anything(),
      expect.anything(),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access',
      expect.anything(),
    );
  });

  it('sets no cookie when resume finds nothing', async () => {
    admission.resume.mockRejectedValue(new NotFoundException());
    const res = response();
    await expect(
      controller.resume(request(), res as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('serves the caller sandbox from current', async () => {
    admission.current.mockResolvedValue(sandbox);
    await expect(
      controller.current({ userId: 'demo-user-1' } as never),
    ).resolves.toBe(sandbox);
    expect(admission.current).toHaveBeenCalledWith('demo-user-1');
  });
});

describe('demo sandbox request validation', () => {
  const provision = new ProvisionDemoSandboxPipe();
  const program = new DemoSandboxProgramPipe();
  const valid = {
    botCheckToken: 't',
    demoTermsVersion: 'demo-1.0',
    agentBridgeAcknowledgmentVersion: 'demo-1.0',
  };

  it('accepts the OpenAPI shapes', () => {
    expect(provision.transform(valid)).toBe(valid);
    const settings = {
      activeCap: 0,
      perIpLimit: 1,
      perIpWindowSeconds: 60,
    };
    expect(program.transform(settings)).toBe(settings);
  });

  it.each([
    {},
    { ...valid, botCheckToken: undefined },
    { botCheckToken: 't', demoTermsVersion: 'demo-1.0' },
    { ...valid, extra: true },
  ])('rejects a provisioning request missing a required proof', (value) => {
    expect(() => provision.transform(value)).toThrow(BadRequestException);
  });

  it.each([
    {
      creationMode: 'OPEN',
      activeCap: 1,
      perIpLimit: 1,
      perIpWindowSeconds: 1,
    },
    {
      activeCap: -1,
      perIpLimit: 1,
      perIpWindowSeconds: 1,
    },
    {
      activeCap: 1,
      perIpLimit: 0,
      perIpWindowSeconds: 1,
    },
    {
      activeCap: 1,
      perIpLimit: 1,
      perIpWindowSeconds: 0,
    },
    { activeCap: 1, perIpLimit: 1 },
    { enabled: true, activeCap: 1, perIpLimit: 1, perIpWindowSeconds: 1 },
  ])('rejects out-of-contract program settings', (value) => {
    expect(() => program.transform(value)).toThrow(BadRequestException);
  });
});
