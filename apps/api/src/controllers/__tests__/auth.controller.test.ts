import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../../auth/services/auth.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Response, Request } from 'express';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { AdminGuard } from '../../auth/guards/admin.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let mockResponse: Partial<Response>;
  let mockRequest: Partial<Request>;
  const originalCorsWhitelist = process.env.CORS_WHITELIST;
  const originalNodeEnv = process.env.NODE_ENV;

  const mockAuthResponse = {
    accessToken: 'jwt-access-token',
    refreshToken: 'jwt-refresh-token',
    user: {
      id: 'user-123' as any, // UserId branded type
      email: 'test@example.com',
      name: 'Test User',
      isActive: true,
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
      currentOrganizationId: 'org-123' as any, // OrganizationId branded type
    },
    expiresIn: 3600,
  };
  const mockEstablishedSession = {
    response: {
      user: mockAuthResponse.user,
      accessToken: 'browser-access-token',
      expiresIn: 900,
    },
    refreshSecret: 'opaque-browser-refresh-secret',
    sessionId: 'session-123' as any,
    familyId: 'family-123' as any,
  };

  beforeEach(async () => {
    process.env.CORS_WHITELIST = 'https://app.heyhey.test/';
    process.env.NODE_ENV = 'test';
    // INTENT: Set up clean test environment for each test
    // This ensures no state pollution between tests
    const mockAuthService = {
      login: jest.fn(),
      register: jest.fn(),
      refreshToken: jest.fn(),
      logout: jest.fn(),
      changePassword: jest.fn(),
      changeCurrentPassword: jest.fn(),
      initiatePasswordRecovery: jest.fn(),
      validateTokenForExternalService: jest.fn(),
      getJwks: jest.fn(),
      getAccountDefaultOrganization: jest.fn(),
      setAccountDefaultOrganization: jest.fn(),
    };

    // INTENT: Mock Express Response to test cookie setting behavior
    // Controllers interact with HTTP responses, so we need to mock these interactions
    mockResponse = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    // INTENT: Mock Express Request to test cookie reading behavior
    // Some endpoints read tokens from cookies, so we need to mock request state
    mockRequest = {
      cookies: {},
      headers: {
        'user-agent': 'test-browser/1.0',
        origin: 'https://app.heyhey.test',
      },
      ip: '203.0.113.10',
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('reads and saves the account preference with the browser credential and exact request', async () => {
    const preference = {
      organizationId: '00000000-0000-4000-8000-000000000001',
    };
    jest
      .spyOn(authService, 'getAccountDefaultOrganization')
      .mockResolvedValue(preference);
    jest
      .spyOn(authService, 'setAccountDefaultOrganization')
      .mockResolvedValue(preference);
    mockRequest.cookies = { accessToken: 'browser-access' };
    expect(
      await controller.getAccountDefaultOrganization(mockRequest as Request),
    ).toEqual(preference);
    expect(authService.getAccountDefaultOrganization).toHaveBeenCalledWith(
      'browser-access',
    );
    expect(
      await controller.setAccountDefaultOrganization(
        mockRequest as Request,
        preference,
      ),
    ).toEqual(preference);
    expect(authService.setAccountDefaultOrganization).toHaveBeenCalledWith(
      'browser-access',
      preference.organizationId,
    );
    expect(mockResponse.cookie).not.toHaveBeenCalled();
  });

  it('does not save a default from an untrusted browser origin', () => {
    mockRequest.headers = { origin: 'https://untrusted.example' };
    expect(() =>
      controller.setAccountDefaultOrganization(mockRequest as Request, {
        organizationId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow();
    expect(authService.setAccountDefaultOrganization).not.toHaveBeenCalled();
  });

  it.each(['selection_required', 'selection_denied'] as const)(
    'retains replacement refresh continuity and clears obsolete access for %s',
    async (status) => {
      const selection = {
        status,
        user: { ...mockAuthResponse.user, currentOrganizationId: null },
        organizations: [],
      };
      jest
        .spyOn(authService, 'refreshToken')
        .mockResolvedValue({ ...mockEstablishedSession, response: selection });
      mockRequest.cookies = { refreshToken: 'presented-secret' };
      const result = await controller.refreshToken(
        mockRequest as Request,
        mockResponse as Response,
      );
      expect(result).toEqual(selection);
      expect(result).not.toHaveProperty('accessToken');
      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'accessToken',
        expect.objectContaining({ path: '/' }),
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        mockEstablishedSession.refreshSecret,
        expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' }),
      );
      expect(mockResponse.clearCookie).not.toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({ path: '/api/v1/auth' }),
      );
    },
  );

  afterAll(() => {
    if (originalCorsWhitelist === undefined) {
      delete process.env.CORS_WHITELIST;
    } else {
      process.env.CORS_WHITELIST = originalCorsWhitelist;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe('login endpoint', () => {
    it('should authenticate user with valid credentials and set secure cookies', async () => {
      // INTENT: Test the happy path for user authentication
      // This ensures that valid login attempts work correctly and security cookies are set
      const loginDto = {
        email: 'test@example.com',
        password: 'validpassword',
      };

      jest
        .spyOn(authService, 'login')
        .mockResolvedValue(mockEstablishedSession);

      const result = await controller.login(
        loginDto,
        mockRequest as Request,
        mockResponse as Response,
      );

      // INTENT: Verify the authentication service was called with correct parameters
      expect(authService.login).toHaveBeenCalledWith(loginDto, {
        ipAddress: '203.0.113.10',
        userAgent: 'test-browser/1.0',
      });

      // INTENT: Verify the response contains authentication data
      expect(result).toEqual(mockEstablishedSession.response);
      expect(result).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(result)).not.toContain(
        mockEstablishedSession.refreshSecret,
      );

      // INTENT: Verify secure HTTP-only cookies are set for token storage
      // This is critical for XSS protection - tokens should not be accessible via JavaScript
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'accessToken',
        mockEstablishedSession.response.accessToken,
        {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/',
          maxAge: 900000,
        },
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        mockEstablishedSession.refreshSecret,
        {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/api/v1/auth',
          maxAge: 2592000000,
        },
      );
    });

    it('drops a leftover demo binding so a real sign-in is not replaced by a demo', async () => {
      jest
        .spyOn(authService, 'login')
        .mockResolvedValue(mockEstablishedSession);

      await controller.login(
        { email: 'test@example.com', password: 'validpassword' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'demoSandboxBinding',
        expect.objectContaining({ path: '/' }),
      );
    });

    it('should handle login failures gracefully', async () => {
      // INTENT: Test error handling for authentication failures
      // This ensures the API provides appropriate feedback for invalid credentials
      const loginDto = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const authError = new BadRequestException('Invalid credentials');
      jest.spyOn(authService, 'login').mockRejectedValue(authError);

      // INTENT: Verify that authentication errors are properly propagated
      await expect(
        controller.login(
          loginDto,
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow(BadRequestException);

      // INTENT: Verify no cookies are set when authentication fails
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });

    it('should handle malformed login data', async () => {
      // INTENT: Test input validation for login requests
      // This ensures the API handles malformed or missing data appropriately
      const invalidLoginDto = {
        email: '', // Empty email should fail validation
        password: 'password',
      };

      const validationError = new BadRequestException('Email is required');
      jest.spyOn(authService, 'login').mockRejectedValue(validationError);

      await expect(
        controller.login(
          invalidLoginDto,
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets no authentication cookies for the password-change-required branch', async () => {
      jest.spyOn(authService, 'login').mockResolvedValue({
        mustChangePassword: true,
        passwordChangeToken: 'password-change-token',
      });

      await expect(
        controller.login(
          {
            email: 'test@example.com',
            password: 'validpassword',
          },
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).resolves.toEqual({
        mustChangePassword: true,
        passwordChangeToken: 'password-change-token',
      });
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });
  });

  describe('password recovery endpoint', () => {
    it('returns the fixed acknowledgement without setting cookies', async () => {
      const acknowledgement = {
        message:
          'If an eligible account exists, recovery instructions will be sent.' as const,
      };
      jest
        .spyOn(authService, 'initiatePasswordRecovery')
        .mockResolvedValue(acknowledgement);

      await expect(
        controller.initiatePasswordRecovery(
          { email: 'person@example.com' },
          mockRequest as Request,
        ),
      ).resolves.toEqual(acknowledgement);
      expect(authService.initiatePasswordRecovery).toHaveBeenCalledWith(
        { email: 'person@example.com' },
        { ipAddress: '203.0.113.10', userAgent: 'test-browser/1.0' },
      );
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });
  });

  describe('register endpoint', () => {
    it('requires authentication', () => {
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.register),
      ).not.toBe(true);
    });

    it('should create new user account and set authentication cookies', async () => {
      // INTENT: Test user registration with valid data
      // This ensures new users can successfully create accounts
      const registerDto = {
        email: 'newuser@example.com',
        password: 'securepassword',
        name: 'New User',
        organizationName: 'New Organization',
      };

      jest
        .spyOn(authService, 'register')
        .mockResolvedValue(mockEstablishedSession);

      const result = await controller.register(
        registerDto,
        mockRequest as Request,
        mockResponse as Response,
      );

      // INTENT: Verify registration service was called correctly
      expect(authService.register).toHaveBeenCalledWith(registerDto, {
        ipAddress: '203.0.113.10',
        userAgent: 'test-browser/1.0',
      });

      // INTENT: Verify new user receives authentication tokens
      expect(result).toEqual(mockEstablishedSession.response);
      expect(result).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(result)).not.toContain(
        mockEstablishedSession.refreshSecret,
      );

      // INTENT: Verify authentication cookies are set for new user
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'accessToken',
        mockEstablishedSession.response.accessToken,
        expect.objectContaining({ path: '/', maxAge: 900000 }),
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        mockEstablishedSession.refreshSecret,
        expect.objectContaining({ path: '/api/v1/auth' }),
      );
      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({ path: '/' }),
      );
    });

    it('should reject registration with duplicate email', async () => {
      // INTENT: Test business rule enforcement for unique email addresses
      // This ensures data integrity and prevents account conflicts
      const registerDto = {
        email: 'existing@example.com',
        password: 'password',
        name: 'Test User',
      };

      const duplicateError = new BadRequestException('Email already exists');
      jest.spyOn(authService, 'register').mockRejectedValue(duplicateError);

      await expect(
        controller.register(
          registerDto,
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not issue browser credentials when session establishment fails', async () => {
      jest
        .spyOn(authService, 'register')
        .mockRejectedValue(new Error('session persistence failed'));

      await expect(
        controller.register(
          {
            email: 'newuser@example.com',
            password: 'securepassword',
            name: 'New User',
          },
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow('session persistence failed');

      expect(mockResponse.cookie).not.toHaveBeenCalled();
      expect(mockResponse.clearCookie).not.toHaveBeenCalled();
    });

    it('should validate password strength requirements', async () => {
      // INTENT: Test security requirements for password complexity
      // This ensures users create secure passwords
      const registerDto = {
        email: 'test@example.com',
        password: '123', // Weak password
        name: 'Test User',
      };

      const passwordError = new BadRequestException('Password too weak');
      jest.spyOn(authService, 'register').mockRejectedValue(passwordError);

      await expect(
        controller.register(
          registerDto,
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('does not expose verified-email completion as an admission route', () => {
    const routes = Object.getOwnPropertyNames(AuthController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) =>
        Reflect.getMetadata(
          'path',
          Object.getOwnPropertyDescriptor(AuthController.prototype, name)!
            .value,
        ),
      );
    expect(routes).not.toContain('verified-email-admission');
  });

  describe('change current password endpoint', () => {
    it('replaces the password through the authenticated browser session boundary', async () => {
      const sessionUser = {
        userId: 'user-123' as any,
        email: 'test@example.com',
        name: 'Test User',
        currentOrgId: 'org-123' as any,
        orgMemberships: [],
        isDevAdmin: false,
        devAdminMode: false,
      };
      const dto = {
        currentPassword: 'current-password',
        newPassword: 'replacement-password',
      };
      jest
        .spyOn(authService, 'changeCurrentPassword')
        .mockResolvedValue(mockEstablishedSession);

      const result = await controller.changeCurrentPassword(
        sessionUser,
        dto,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(authService.changeCurrentPassword).toHaveBeenCalledWith(
        sessionUser.userId,
        dto,
        {
          ipAddress: '203.0.113.10',
          userAgent: 'test-browser/1.0',
        },
      );
      expect(result).toEqual(mockEstablishedSession.response);
      expect(result).not.toHaveProperty('refreshToken');
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        mockEstablishedSession.refreshSecret,
        expect.objectContaining({ path: '/api/v1/auth' }),
      );
    });

    it('does not set replacement cookies when the current password is rejected', async () => {
      jest
        .spyOn(authService, 'changeCurrentPassword')
        .mockRejectedValue(
          new UnauthorizedException('Invalid current password'),
        );

      await expect(
        controller.changeCurrentPassword(
          'user-123' as any,
          {
            currentPassword: 'wrong-password',
            newPassword: 'replacement-password',
          },
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow('Invalid current password');
      expect(mockResponse.cookie).not.toHaveBeenCalled();
      expect(mockResponse.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('refresh token endpoint', () => {
    it('passes an explicit organization selection into cookie-backed rotation', async () => {
      mockRequest.cookies = { refreshToken: 'cookie-refresh-token' };
      jest
        .spyOn(authService, 'refreshToken')
        .mockResolvedValue(mockEstablishedSession);

      await controller.refreshToken(
        mockRequest as Request,
        mockResponse as Response,
        { organizationId: '11111111-1111-4111-8111-111111111111' },
      );

      expect(authService.refreshToken).toHaveBeenCalledWith(
        'cookie-refresh-token',
        expect.any(Object),
        '11111111-1111-4111-8111-111111111111',
      );
    });

    it('should refresh only from the HttpOnly cookie and return no refresh material', async () => {
      // INTENT: Test token refresh using HTTP-only cookies
      // This provides a secure way to refresh tokens without exposing them to JavaScript
      mockRequest.cookies = { refreshToken: 'cookie-refresh-token' };

      jest
        .spyOn(authService, 'refreshToken')
        .mockResolvedValue(mockEstablishedSession);

      const result = await controller.refreshToken(
        mockRequest as Request,
        mockResponse as Response,
      );

      // INTENT: Verify service uses token from cookies when body is empty
      expect(authService.refreshToken).toHaveBeenCalledWith(
        'cookie-refresh-token',
        {
          ipAddress: '203.0.113.10',
          userAgent: 'test-browser/1.0',
        },
      );
      expect(result).toEqual(mockEstablishedSession.response);
      expect(result).not.toHaveProperty('refreshToken');
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        mockEstablishedSession.refreshSecret,
        expect.objectContaining({ path: '/api/v1/auth' }),
      );
    });

    it('never uses a body-supplied legacy refresh value', async () => {
      mockRequest.body = { refreshToken: 'legacy-body-refresh-token' };

      await expect(
        controller.refreshToken(
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(authService.refreshToken).not.toHaveBeenCalled();
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('accessToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      });
    });

    it('should reject refresh when no token provided', async () => {
      // INTENT: Test security validation for missing refresh tokens
      // This prevents unauthorized token refresh attempts
      mockRequest.cookies = {}; // No token in cookies

      await expect(
        controller.refreshToken(
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);

      // INTENT: Verify service is not called when no token available
      expect(authService.refreshToken).not.toHaveBeenCalled();
      expect(mockResponse.clearCookie).toHaveBeenCalled();
    });

    it('should handle invalid refresh tokens', async () => {
      // INTENT: Test security handling of tampered or expired refresh tokens
      // This ensures the system properly rejects invalid authentication attempts
      mockRequest.cookies = { refreshToken: 'invalid-token' };

      const invalidTokenError = new UnauthorizedException(
        'Invalid refresh token',
      );
      jest
        .spyOn(authService, 'refreshToken')
        .mockRejectedValue(invalidTokenError);

      await expect(
        controller.refreshToken(
          mockRequest as Request,
          mockResponse as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.clearCookie).toHaveBeenCalled();
    });
  });

  describe('logout endpoint', () => {
    it('revokes the resolved browser session before clearing cookies', async () => {
      // INTENT: Test secure logout functionality
      // This ensures users can properly terminate their sessions
      mockRequest.cookies = {
        refreshToken: 'refresh-secret',
        accessToken: 'access-token',
      };
      const result = await controller.logout(
        mockRequest as Request,
        mockResponse as Response,
      );

      // INTENT: Verify logout confirmation message
      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(authService.logout).toHaveBeenCalledWith(
        'refresh-secret',
        'access-token',
        {
          ipAddress: '203.0.113.10',
          userAgent: 'test-browser/1.0',
        },
      );
      expect(
        (authService.logout as jest.Mock).mock.invocationCallOrder[0]!,
      ).toBeLessThan(
        (mockResponse.clearCookie as jest.Mock).mock.invocationCallOrder[0]!,
      );

      // INTENT: Verify both authentication cookies are cleared
      // This prevents session hijacking after logout
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('accessToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      });
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refreshToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/v1/auth',
      });
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refreshToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      });
    });

    it('makes the browser forget its demo so resume cannot sign it back in', async () => {
      mockRequest.cookies = {
        refreshToken: 'refresh-secret',
        accessToken: 'access-token',
      };

      await controller.logout(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'demoSandboxBinding',
        expect.objectContaining({ path: '/' }),
      );
    });

    it('does not clear cookies when session revocation fails', async () => {
      jest
        .spyOn(authService, 'logout')
        .mockRejectedValue(new Error('database unavailable'));

      await expect(
        controller.logout(mockRequest as Request, mockResponse as Response),
      ).rejects.toThrow('database unavailable');
      expect(mockResponse.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('browser session mutation origin boundary', () => {
    it.each([
      ['refresh', 'missing', undefined],
      ['refresh', 'malformed', 'not an origin'],
      ['refresh', 'untrusted', 'https://attacker.example'],
      ['refresh', 'same-site sibling', 'https://admin.heyhey.test'],
      ['logout', 'missing', undefined],
      ['logout', 'malformed', 'https://app.heyhey.test/path'],
      ['logout', 'untrusted', 'https://attacker.example'],
      ['logout', 'same-site sibling', 'https://admin.heyhey.test'],
    ] as const)(
      'rejects a %s mutation from a %s origin before session state changes',
      async (endpoint, _originCase, origin) => {
        mockRequest.cookies = {
          refreshToken: 'presented-refresh-secret',
          accessToken: 'presented-access-token',
        };
        mockRequest.headers = {
          ...mockRequest.headers,
          ...(origin === undefined ? {} : { origin }),
        };
        if (origin === undefined) {
          delete mockRequest.headers.origin;
        }

        const mutation =
          endpoint === 'refresh'
            ? controller.refreshToken(
                mockRequest as Request,
                mockResponse as Response,
              )
            : controller.logout(
                mockRequest as Request,
                mockResponse as Response,
              );

        await expect(mutation).rejects.toThrow(
          new UnauthorizedException('Browser session mutation is not allowed'),
        );
        expect(authService.refreshToken as jest.Mock).not.toHaveBeenCalled();
        expect(authService.logout as jest.Mock).not.toHaveBeenCalled();
        expect(mockResponse.cookie).not.toHaveBeenCalled();
        expect(mockResponse.clearCookie).not.toHaveBeenCalled();
      },
    );
  });

  describe('change-password endpoint', () => {
    it('sets only the fresh committed browser session', async () => {
      jest
        .spyOn(authService, 'changePassword')
        .mockResolvedValue(mockEstablishedSession);
      const dto = {
        passwordChangeToken: 'password-change',
        newPassword: 'replacement-password',
      };

      const result = await controller.changePassword(
        dto,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(authService.changePassword).toHaveBeenCalledWith(dto, {
        ipAddress: '203.0.113.10',
        userAgent: 'test-browser/1.0',
      });
      expect(result).toEqual(mockEstablishedSession.response);
      expect(result).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(result)).not.toContain(
        mockEstablishedSession.refreshSecret,
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        mockEstablishedSession.refreshSecret,
        expect.objectContaining({ path: '/api/v1/auth' }),
      );
    });

    it('drops a leftover demo binding when it completes a real sign-in', async () => {
      jest
        .spyOn(authService, 'changePassword')
        .mockResolvedValue(mockEstablishedSession);

      await controller.changePassword(
        { passwordChangeToken: 'password-change', newPassword: 'replacement' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'demoSandboxBinding',
        expect.objectContaining({ path: '/' }),
      );
    });
  });

  describe('token validation endpoint', () => {
    it('should validate legitimate JWT tokens for external services', async () => {
      // INTENT: Test token validation for service-to-service authentication
      // This allows other services to verify user authentication independently
      const validToken = 'valid-jwt-token';
      const validationResponse = {
        valid: true,
        payload: {
          sub: 'user-123' as any,
          email: 'test@example.com',
          currentOrgId: 'org-123',
          orgMemberships: [{ orgId: 'org-123', role: 'ADMIN' }],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        } as any,
      };

      jest
        .spyOn(authService, 'validateTokenForExternalService')
        .mockResolvedValue(validationResponse);

      const result = await controller.validateToken({ token: validToken });

      // INTENT: Verify validation service was called with provided token
      expect(authService.validateTokenForExternalService).toHaveBeenCalledWith(
        validToken,
      );

      // INTENT: Verify validation response includes user payload
      expect(result).toEqual(validationResponse);
      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe('user-123');
    });

    it('should reject invalid or expired tokens', async () => {
      // INTENT: Test security validation for tampered or expired tokens
      // This protects against unauthorized access attempts from external services
      const invalidToken = 'invalid-jwt-token';
      const validationResponse = {
        valid: false,
        error: 'Token is invalid or expired',
      };

      jest
        .spyOn(authService, 'validateTokenForExternalService')
        .mockResolvedValue(validationResponse);

      const result = await controller.validateToken({ token: invalidToken });

      // INTENT: Verify rejection response for invalid tokens
      expect(result).toEqual(validationResponse);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('JWKS endpoint', () => {
    it('should provide public keys for external token validation', async () => {
      // INTENT: Test JWKS endpoint for distributed authentication
      // This allows external services to validate tokens without shared secrets
      const mockJwks = {
        keys: [
          {
            kty: 'RSA',
            use: 'sig',
            kid: 'key-id-1',
            n: 'modulus-value',
            e: 'AQAB',
            alg: 'RS256',
          },
        ],
      };

      jest.spyOn(authService, 'getJwks').mockResolvedValue(mockJwks);

      const result = await controller.getJwks();

      // INTENT: Verify JWKS service provides public key data
      expect(authService.getJwks).toHaveBeenCalled();
      expect(result).toEqual(mockJwks);
      expect(result.keys).toHaveLength(1);
      expect(result.keys[0].kty).toBe('RSA');
    });

    it('should handle JWKS retrieval errors gracefully', async () => {
      // INTENT: Test error handling for JWKS endpoint failures
      // This ensures the endpoint fails gracefully if key retrieval fails
      const jwksError = new Error('Failed to retrieve keys');
      jest.spyOn(authService, 'getJwks').mockRejectedValue(jwksError);

      await expect(controller.getJwks()).rejects.toThrow(
        'Failed to retrieve keys',
      );
    });
  });
});
