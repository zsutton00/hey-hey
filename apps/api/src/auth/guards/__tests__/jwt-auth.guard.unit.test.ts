import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { JwtStrategy } from '../../strategies/jwt.strategy';

describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  describe('canActivate – public vs. protected', () => {
    it('returns true immediately for @Public routes', () => {
      const ctx = {
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;
      // Mock reflector to indicate route is public
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce(true as any);

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('extractJwtFromRequest', () => {
    const extractor = (JwtStrategy as any).extractJwtFromRequest;

    it('prefers Authorization header bearer token', () => {
      const req = {
        headers: { authorization: 'Bearer headerToken' },
        cookies: { accessToken: 'cookieToken' },
      };
      expect(extractor(req)).toBe('headerToken');
    });

    it('falls back to accessToken cookie', () => {
      const req = { headers: {}, cookies: { accessToken: 'cookieToken' } };
      expect(extractor(req)).toBe('cookieToken');
    });

    it('returns null when no token present', () => {
      const req = { headers: {}, cookies: {} };
      expect(extractor(req)).toBeNull();
    });
  });
});
