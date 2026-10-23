import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ControllerBindingOriginGuard } from '../controller-binding-origin.guard';

const contextFor = (request: {
  cookies?: Record<string, string>;
  origin?: string;
}): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        cookies: request.cookies,
        get: (name: string) =>
          name.toLowerCase() === 'origin' ? request.origin : undefined,
      }),
    }),
  }) as ExecutionContext;

describe('ControllerBindingOriginGuard', () => {
  const originalWhitelist = process.env.CORS_WHITELIST;

  beforeEach(() => {
    process.env.CORS_WHITELIST = 'https://app.heyhey.dev';
  });

  afterAll(() => {
    process.env.CORS_WHITELIST = originalWhitelist;
  });

  it('admits a configured origin carrying the controller cookie', () => {
    const guard = new ControllerBindingOriginGuard();
    expect(
      guard.canActivate(
        contextFor({
          cookies: { hey_hey_controller_binding: 'secret' },
          origin: 'https://app.heyhey.dev',
        }),
      ),
    ).toBe(true);
  });

  it.each([undefined, 'https://foreign.example'])(
    'denies cookie admission from origin %s',
    (origin) => {
      const guard = new ControllerBindingOriginGuard();
      expect(() =>
        guard.canActivate(
          contextFor({
            cookies: { hey_hey_controller_binding: 'secret' },
            origin,
          }),
        ),
      ).toThrow(ForbiddenException);
    },
  );

  it('leaves bearer-only and CLI requests outside the cookie boundary', () => {
    const guard = new ControllerBindingOriginGuard();
    expect(guard.canActivate(contextFor({}))).toBe(true);
  });
});
