import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { OAuthService } from '../oauth.service';
import { UserService } from '../../../services/user.service';
import { AuthService } from '../../services/auth.service';
import { JwtKeysService } from '../../services/jwt-keys.service';
import { RedisService } from '../../../core/redis/redis.service';
import {
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  REDIS_PREFIX_AUTH_CODE,
  REDIS_PREFIX_REVOKED,
} from '../oauth.constants';
import * as TestUtils from '../../../utils/testUtils';

describe('OAuthService', () => {
  let service: OAuthService;
  const { testIds } = TestUtils;

  const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockUserService = {
    findByEmail: jest.fn(),
    validatePassword: jest.fn(),
  };

  const mockAuthService = {
    generateTokensForUserId: jest.fn(),
  };

  const mockJwtKeysService = {
    verifyToken: jest.fn(),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: JwtKeysService, useValue: mockJwtKeysService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
    jest.clearAllMocks();
    mockRedisService.getClient.mockReturnValue(mockRedisClient);
  });

  describe('validateClient', () => {
    it('should return null for valid client_id without secret', () => {
      const result = service.validateClient(OAUTH_CLIENT_ID);
      expect(result).toBeNull();
    });

    it('should return null for valid client_id and secret', () => {
      const result = service.validateClient(
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
      );
      expect(result).toBeNull();
    });

    it('should return error for unknown client_id', () => {
      const result = service.validateClient('unknown');
      expect(result).toEqual({
        error: 'invalid_client',
        error_description: 'Unknown client',
      });
    });

    it('should return error for wrong client_secret', () => {
      const result = service.validateClient(OAUTH_CLIENT_ID, 'wrong-secret');
      expect(result).toEqual({
        error: 'invalid_client',
        error_description: 'Bad client secret',
      });
    });
  });

  describe('validateRedirectUri', () => {
    it('should accept valid localhost callback URI', () => {
      const result = service.validateRedirectUri(
        'http://127.0.0.1:12345/callback',
      );
      expect(result).toBeNull();
    });

    it('should reject non-localhost URIs', () => {
      const result = service.validateRedirectUri(
        'http://evil.com:12345/callback',
      );
      expect(result).toEqual({
        error: 'invalid_request',
        error_description: 'Invalid redirect_uri',
      });
    });

    it('should reject wrong path', () => {
      const result = service.validateRedirectUri('http://127.0.0.1:12345/evil');
      expect(result).toEqual({
        error: 'invalid_request',
        error_description: 'Invalid redirect_uri',
      });
    });
  });

  describe('authenticateUser', () => {
    it('should return userId for valid credentials', async () => {
      const mockUser = {
        id: testIds.user,
        email: 'test@example.com',
        isActive: true,
      };
      mockUserService.findByEmail.mockResolvedValue(mockUser);
      mockUserService.validatePassword.mockResolvedValue(true);

      const result = await service.authenticateUser(
        'test@example.com',
        'password',
      );
      expect(result).toBe(testIds.user);
    });

    it('should return null for unknown email', async () => {
      mockUserService.findByEmail.mockResolvedValue(null);

      const result = await service.authenticateUser(
        'unknown@example.com',
        'password',
      );
      expect(result).toBeNull();
    });

    it('should return null for wrong password', async () => {
      const mockUser = {
        id: testIds.user,
        email: 'test@example.com',
        isActive: true,
      };
      mockUserService.findByEmail.mockResolvedValue(mockUser);
      mockUserService.validatePassword.mockResolvedValue(false);

      const result = await service.authenticateUser(
        'test@example.com',
        'wrong',
      );
      expect(result).toBeNull();
    });

    it('should return null for inactive user', async () => {
      mockUserService.findByEmail.mockResolvedValue({
        id: testIds.user,
        email: 'test@example.com',
        isActive: false,
      });

      const result = await service.authenticateUser(
        'test@example.com',
        'password',
      );
      expect(result).toBeNull();
    });
  });

  describe('generateAuthorizationCode', () => {
    it('should store code in Redis and return 64-char hex string', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      const code = await service.generateAuthorizationCode(
        testIds.user,
        OAUTH_CLIENT_ID,
        'http://127.0.0.1:9999/callback',
        'read write',
        'test-state',
      );

      expect(code).toMatch(/^[a-f0-9]{64}$/);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `${REDIS_PREFIX_AUTH_CODE}${code}`,
        expect.any(String),
        'EX',
        300,
      );

      const storedValue = JSON.parse(
        mockRedisClient.set.mock.calls[0][1] as string,
      );
      expect(storedValue.userId).toBe(testIds.user);
      expect(storedValue.clientId).toBe(OAUTH_CLIENT_ID);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    const redirectUri = 'http://127.0.0.1:9999/callback';

    it('should exchange valid code for tokens', async () => {
      const storedCode = {
        userId: testIds.user,
        clientId: OAUTH_CLIENT_ID,
        redirectUri,
        scope: 'read write',
        state: 'test-state',
        createdAt: Date.now(),
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(storedCode));
      mockRedisClient.del.mockResolvedValue(1);
      mockAuthService.generateTokensForUserId.mockResolvedValue({
        accessToken: 'access-jwt',
        refreshToken: 'refresh-jwt',
        expiresIn: 86400,
        user: {},
      });

      const result = await service.exchangeAuthorizationCode(
        'valid-code',
        redirectUri,
        OAUTH_CLIENT_ID,
      );

      expect(result).toEqual({
        access_token: 'access-jwt',
        refresh_token: 'refresh-jwt',
        expires_in: 86400,
        scope: 'read write',
        token_type: 'Bearer',
      });

      // Code should be deleted (single-use)
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        `${REDIS_PREFIX_AUTH_CODE}valid-code`,
      );
    });

    it('should reject expired/missing code', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.exchangeAuthorizationCode(
        'expired-code',
        redirectUri,
        OAUTH_CLIENT_ID,
      );

      expect(result).toEqual({
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired',
      });
    });

    it('should reject code with mismatched client_id', async () => {
      const storedCode = {
        userId: testIds.user,
        clientId: 'other-client',
        redirectUri,
        scope: 'read write',
        state: 'test-state',
        createdAt: Date.now(),
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(storedCode));
      mockRedisClient.del.mockResolvedValue(1);

      const result = await service.exchangeAuthorizationCode(
        'code',
        redirectUri,
        OAUTH_CLIENT_ID,
      );

      expect(result).toEqual({
        error: 'invalid_grant',
        error_description: 'Client mismatch',
      });
    });

    it('should reject code with mismatched redirect_uri', async () => {
      const storedCode = {
        userId: testIds.user,
        clientId: OAUTH_CLIENT_ID,
        redirectUri: 'http://127.0.0.1:1111/callback',
        scope: 'read write',
        state: 'test-state',
        createdAt: Date.now(),
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(storedCode));
      mockRedisClient.del.mockResolvedValue(1);

      const result = await service.exchangeAuthorizationCode(
        'code',
        redirectUri,
        OAUTH_CLIENT_ID,
      );

      expect(result).toEqual({
        error: 'invalid_grant',
        error_description: 'Redirect URI mismatch',
      });
    });
  });

  describe('refreshOAuthToken', () => {
    it('should return new tokens for valid refresh token', async () => {
      mockJwtKeysService.verifyToken.mockReturnValue({
        sub: testIds.user,
        type: 'refresh',
      });
      mockRedisClient.get.mockResolvedValue(null); // not revoked
      mockAuthService.generateTokensForUserId.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 86400,
        user: {},
      });

      const result = await service.refreshOAuthToken('valid-refresh-jwt');

      expect(result).toEqual({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 86400,
        scope: 'read write',
        token_type: 'Bearer',
      });
    });

    it('should reject non-refresh token', async () => {
      mockJwtKeysService.verifyToken.mockReturnValue({
        sub: testIds.user,
        type: 'access',
      });

      const result = await service.refreshOAuthToken('access-jwt');

      expect(result).toEqual({
        error: 'invalid_grant',
        error_description: 'Invalid refresh token',
      });
    });

    it('should reject revoked token', async () => {
      mockJwtKeysService.verifyToken.mockReturnValue({
        sub: testIds.user,
        type: 'refresh',
      });
      mockRedisClient.get.mockResolvedValue('1'); // revoked

      const result = await service.refreshOAuthToken('revoked-refresh-jwt');

      expect(result).toEqual({
        error: 'invalid_grant',
        error_description: 'Token has been revoked',
      });
    });

    it('should reject expired token', async () => {
      const expiredError = new Error('jwt expired');
      expiredError.name = 'TokenExpiredError';
      mockJwtKeysService.verifyToken.mockImplementation(() => {
        throw expiredError;
      });

      const result = await service.refreshOAuthToken('expired-jwt');

      expect(result).toEqual({
        error: 'invalid_grant',
        error_description: 'Refresh token is invalid or expired',
      });
    });

    it('should reject malformed token', async () => {
      const malformedError = new Error('jwt malformed');
      malformedError.name = 'JsonWebTokenError';
      mockJwtKeysService.verifyToken.mockImplementation(() => {
        throw malformedError;
      });

      const result = await service.refreshOAuthToken('malformed-token');

      expect(result).toEqual({
        error: 'invalid_grant',
        error_description: 'Refresh token is invalid or expired',
      });
    });

    it('should accept refresh token with bearer prefix', async () => {
      mockJwtKeysService.verifyToken.mockReturnValue({
        sub: testIds.user,
        type: 'refresh',
      });
      mockRedisClient.get.mockResolvedValue(null);
      mockAuthService.generateTokensForUserId.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 86400,
        user: {},
      });

      const result = await service.refreshOAuthToken(
        '  Bearer valid-refresh-jwt  ',
      );

      expect(mockJwtKeysService.verifyToken).toHaveBeenCalledWith(
        'valid-refresh-jwt',
      );
      expect(result).toEqual({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 86400,
        scope: 'read write',
        token_type: 'Bearer',
      });
    });
  });

  describe('revokeToken', () => {
    it('should store token hash in Redis', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.revokeToken('some-token');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining(REDIS_PREFIX_REVOKED),
        '1',
        'EX',
        604800,
      );
    });
  });
});
