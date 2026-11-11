import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthController } from '../../controllers/auth.controller';
import { AppModule } from '../../app.module';
import { LocalApplicationModule } from '../local-application.module';
import { LocalAuthController } from '../local-auth.controller';
import { LocalAccessService } from '../local-access.service';

const CONFIGURED_ORIGIN = 'http://localhost:3850';
const LOCAL_ROUTE = /^local\//;

const routePaths = (controller: { prototype: object }): string[] =>
  Object.getOwnPropertyNames(controller.prototype)
    .map((name) =>
      Reflect.getMetadata('path', controller.prototype[name as never]),
    )
    .filter((path): path is string => typeof path === 'string');

describe('Local browser handoff boundary', () => {
  const session = {
    response: { user: {}, accessToken: 'access', expiresIn: 900 },
    refreshSecret: 'refresh',
    sessionId: 'session-1',
    familyId: 'family-1',
  };
  let localAccess: { completeLocalHandoff: jest.Mock };
  let controller: LocalAuthController;
  let response: Partial<Response>;

  const requestFrom = (origin: string, fetchSite: string): Request =>
    ({
      headers: {
        origin,
        'sec-fetch-site': fetchSite,
        'user-agent': 'test-browser/1.0',
      },
      ip: '127.0.0.1',
    }) as unknown as Request;

  beforeEach(() => {
    localAccess = {
      completeLocalHandoff: jest.fn().mockResolvedValue(session),
    };
    controller = new LocalAuthController(
      localAccess as unknown as LocalAccessService,
      new ConfigService({ ACCOUNT_PASSKEY_ORIGIN: CONFIGURED_ORIGIN }),
    );
    response = { cookie: jest.fn() };
  });

  it('consumes a handoff from the local web origin and sets the browser session', async () => {
    await controller.localHandoff(
      { handoffToken: 'a'.repeat(43) },
      requestFrom(CONFIGURED_ORIGIN, 'same-site'),
      response as Response,
    );

    expect(localAccess.completeLocalHandoff).toHaveBeenCalledWith(
      'a'.repeat(43),
      expect.objectContaining({ userAgent: 'test-browser/1.0' }),
    );
    expect(response.cookie).toHaveBeenCalled();
  });

  it('rejects the previous default origin once another origin is configured', async () => {
    await expect(
      controller.localHandoff(
        { handoffToken: 'a'.repeat(43) },
        requestFrom('http://localhost:5173', 'same-site'),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(localAccess.completeLocalHandoff).not.toHaveBeenCalled();
  });

  it('rejects a website origin before consuming a handoff', async () => {
    await expect(
      controller.localHandoff(
        { handoffToken: 'a'.repeat(43) },
        requestFrom('https://attacker.example', 'cross-site'),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(localAccess.completeLocalHandoff).not.toHaveBeenCalled();
  });
});

describe('Hosted composition', () => {
  it('registers no local authentication route', () => {
    expect(
      routePaths(AuthController).filter((p) => LOCAL_ROUTE.test(p)),
    ).toEqual([]);
    expect(
      routePaths(LocalAuthController).filter((p) => LOCAL_ROUTE.test(p)),
    ).toHaveLength(5);
  });

  it('does not import the local module outside a local application', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule);

    expect(imports).not.toContain(LocalApplicationModule);
  });
});
