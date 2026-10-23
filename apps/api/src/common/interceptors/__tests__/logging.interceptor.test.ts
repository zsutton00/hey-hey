import { BadRequestException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { getNamespace } from 'cls-hooked';
import { LoggingInterceptor } from '../logging.interceptor';

describe('LoggingInterceptor correlation boundary', () => {
  it('keeps authenticated attribution separate across overlapping users and ignores spoofed headers', async () => {
    const observations: Record<string, unknown>[] = [];
    const logger = {
      logRequest: jest.fn(() => {
        observations.push({
          ...getNamespace('request-context')?.get('context'),
        });
      }),
      logError: jest.fn(),
    };
    const interceptor = new LoggingInterceptor(
      logger as never,
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector,
    );
    const run = (suffix: string, delay: number) => {
      const request = {
        user: { userId: `user-${suffix}`, currentOrgId: `active-${suffix}` },
        params: { organizationId: `route-${suffix}`, id: `project-${suffix}` },
        headers: {
          'x-user-id': 'spoofed-user',
          'x-organization-id': 'spoofed-org',
          'x-project-id': 'spoofed-project',
        },
        hostname: 'staging.heyhey.dev',
        method: 'GET',
        path: `/projects/project-${suffix}`,
      };
      const context = {
        getHandler: jest.fn(),
        getClass: () => ({ name: 'ProjectController' }),
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => ({ statusCode: 200, setHeader: jest.fn() }),
        }),
      };
      return firstValueFrom(
        interceptor.intercept(context as never, {
          handle: () =>
            new Observable((subscriber) => {
              const timer = setTimeout(() => {
                subscriber.next({ ok: true });
                subscriber.complete();
              }, delay);
              return () => clearTimeout(timer);
            }),
        }),
      );
    };
    await Promise.all([run('a', 20), run('b', 0)]);
    expect(observations).toEqual(
      ['b', 'a'].map((suffix) =>
        expect.objectContaining({
          userId: `user-${suffix}`,
          organizationId: `route-${suffix}`,
          projectId: `project-${suffix}`,
          authenticatedOrganizationId: `active-${suffix}`,
          routeOrganizationId: `route-${suffix}`,
          routeProjectId: `project-${suffix}`,
          requestHost: 'staging.heyhey.dev',
          apiInstance: expect.any(String),
        }),
      ),
    );
  });

  it('creates and returns request and correlation identifiers', () => {
    const logger = {
      logRequest: jest.fn(),
      logError: jest.fn(),
    };
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const interceptor = new LoggingInterceptor(logger as never, reflector);
    const request = {
      headers: {},
      method: 'GET',
      path: '/health',
    };
    const response = {
      statusCode: 200,
      setHeader: jest.fn(),
    };
    const executionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
    const next = { handle: () => of({ ok: true }) };

    interceptor.intercept(executionContext as never, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      expect.any(String),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      expect.any(String),
    );
    expect(request.headers).toEqual({
      'x-request-id': expect.any(String),
      'x-correlation-id': expect.any(String),
    });
  });

  it('logs the thrown HTTP status instead of a success decorator status', () => {
    const logger = {
      logRequest: jest.fn(),
      logError: jest.fn(),
    };
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const interceptor = new LoggingInterceptor(logger as never, reflector);
    const request = {
      headers: {},
      method: 'DELETE',
      path: '/agent-sessions/session-1',
    };
    const response = {
      statusCode: 204,
      setHeader: jest.fn(),
    };
    const executionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
    const failure = new HttpException('database failure', 500);

    interceptor
      .intercept(executionContext as never, {
        handle: () => throwError(() => failure),
      })
      .subscribe({ error: () => undefined });

    expect(logger.logRequest).toHaveBeenCalledWith(
      'DELETE',
      '/agent-sessions/session-1',
      500,
      expect.any(Number),
    );
    expect(logger.logRequest).not.toHaveBeenCalledWith(
      'DELETE',
      '/agent-sessions/session-1',
      204,
      expect.any(Number),
    );
    expect(logger.logError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('logs structured issues from a projected change-set failure', () => {
    const logger = {
      logRequest: jest.fn(),
      logError: jest.fn(),
    };
    const interceptor = new LoggingInterceptor(
      logger as never,
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector,
    );
    const request = {
      headers: {},
      params: {
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      method: 'POST',
      path: '/proposals',
    };
    const response = {
      statusCode: 201,
      setHeader: jest.fn(),
    };
    const executionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
    const issues = [
      {
        field: 'updates.operations[3].direction',
        code: 'invalid',
        reason: 'LOOP workflow edges must not declare direction',
        layer: 'structural',
      },
    ];
    const failure = new BadRequestException({
      message: 'Proposal contains an invalid projected change set',
      projection: { valid: false, issues },
    });

    interceptor
      .intercept(executionContext as never, {
        handle: () => throwError(() => failure),
      })
      .subscribe({ error: () => undefined });

    expect(logger.logError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        method: 'POST',
        path: '/proposals',
        issues,
      }),
    );
  });
});
