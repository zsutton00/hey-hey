import { Test, TestingModule } from '@nestjs/testing';
import { OAuthController } from '../oauth.controller';
import { OAuthService } from '../oauth.service';
import { OAUTH_CLIENT_ID } from '../oauth.constants';
import * as TestUtils from '../../../utils/testUtils';

describe('OAuthController', () => {
  let controller: OAuthController;
  const { testIds } = TestUtils;

  const mockOAuthService = {
    validateClient: jest.fn(),
    validateRedirectUri: jest.fn(),
    authenticateUser: jest.fn(),
    generateAuthorizationCode: jest.fn(),
    exchangeAuthorizationCode: jest.fn(),
    refreshOAuthToken: jest.fn(),
    revokeToken: jest.fn(),
  };

  const mockResponse = () => {
    const res: Record<string, jest.Mock> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.type = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.redirect = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [{ provide: OAuthService, useValue: mockOAuthService }],
    }).compile();

    controller = module.get<OAuthController>(OAuthController);
    jest.clearAllMocks();
  });

  describe('GET /authorize', () => {
    const validQuery = {
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:9999/callback',
      scope: 'read write',
      state: 'random-state',
    };

    it('should render login page for valid params', () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      mockOAuthService.validateRedirectUri.mockReturnValue(null);
      const res = mockResponse();

      controller.getAuthorize(validQuery, res as any);

      expect(res.type).toHaveBeenCalledWith('text/html');
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('Sign in to Hey Hey'),
      );
    });

    it('should reject unsupported response_type', () => {
      const res = mockResponse();

      controller.getAuthorize(
        { ...validQuery, response_type: 'token' },
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'unsupported_response_type' }),
      );
    });

    it('should reject invalid client', () => {
      mockOAuthService.validateClient.mockReturnValue({
        error: 'invalid_client',
      });
      const res = mockResponse();

      controller.getAuthorize(validQuery, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing state', () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      mockOAuthService.validateRedirectUri.mockReturnValue(null);
      const res = mockResponse();

      controller.getAuthorize({ ...validQuery, state: '' }, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'invalid_request' }),
      );
    });
  });

  describe('POST /authorize', () => {
    const validBody = {
      email: 'test@example.com',
      password: 'password',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:9999/callback',
      scope: 'read write',
      state: 'random-state',
    };

    it('should redirect with code on successful login', async () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      mockOAuthService.validateRedirectUri.mockReturnValue(null);
      mockOAuthService.authenticateUser.mockResolvedValue(testIds.user);
      mockOAuthService.generateAuthorizationCode.mockResolvedValue(
        'auth-code-123',
      );
      const res = mockResponse();

      await controller.postAuthorize(validBody, res as any);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('code=auth-code-123'),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('state=random-state'),
      );
    });

    it('should re-render login with error on bad credentials', async () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      mockOAuthService.validateRedirectUri.mockReturnValue(null);
      mockOAuthService.authenticateUser.mockResolvedValue(null);
      const res = mockResponse();

      await controller.postAuthorize(validBody, res as any);

      expect(res.type).toHaveBeenCalledWith('text/html');
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('Invalid email or password'),
      );
    });
  });

  describe('POST /token', () => {
    it('should exchange authorization code for tokens', async () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      mockOAuthService.exchangeAuthorizationCode.mockResolvedValue({
        access_token: 'jwt',
        refresh_token: 'refresh-jwt',
        expires_in: 86400,
        scope: 'read write',
        token_type: 'Bearer',
      });
      const res = mockResponse();

      await controller.token(
        {
          grant_type: 'authorization_code',
          code: 'auth-code',
          redirect_uri: 'http://127.0.0.1:9999/callback',
          client_id: OAUTH_CLIENT_ID,
          client_secret: 'secret',
        },
        res as any,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ access_token: 'jwt' }),
      );
    });

    it('should refresh tokens', async () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      mockOAuthService.refreshOAuthToken.mockResolvedValue({
        access_token: 'new-jwt',
        refresh_token: 'new-refresh',
        expires_in: 86400,
        scope: 'read write',
        token_type: 'Bearer',
      });
      const res = mockResponse();

      await controller.token(
        {
          grant_type: 'refresh_token',
          refresh_token: 'old-refresh',
          client_id: OAUTH_CLIENT_ID,
          client_secret: 'secret',
        },
        res as any,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ access_token: 'new-jwt' }),
      );
    });

    it('should reject invalid refresh_token payload', async () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      const res = mockResponse();

      await controller.token(
        {
          grant_type: 'refresh_token',
          refresh_token: { value: 'not-a-string' } as any,
          client_id: OAUTH_CLIENT_ID,
          client_secret: 'secret',
        },
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'invalid_request' }),
      );
      expect(mockOAuthService.refreshOAuthToken).not.toHaveBeenCalled();
    });

    it('should reject invalid client on token request', async () => {
      mockOAuthService.validateClient.mockReturnValue({
        error: 'invalid_client',
      });
      const res = mockResponse();

      await controller.token(
        {
          grant_type: 'authorization_code',
          code: 'code',
          redirect_uri: 'http://127.0.0.1:9999/callback',
          client_id: 'bad',
          client_secret: 'bad',
        },
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should reject unsupported grant_type', async () => {
      mockOAuthService.validateClient.mockReturnValue(null);
      const res = mockResponse();

      await controller.token(
        {
          grant_type: 'client_credentials' as any,
          client_id: OAUTH_CLIENT_ID,
          client_secret: 'secret',
        },
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'unsupported_grant_type' }),
      );
    });
  });

  describe('POST /revoke', () => {
    it('should always return 200', async () => {
      mockOAuthService.revokeToken.mockResolvedValue(undefined);
      const res = mockResponse();

      await controller.revoke(
        {
          token: 'some-token',
          client_id: OAUTH_CLIENT_ID,
          client_secret: 'secret',
        },
        res as any,
      );

      expect(res.json).toHaveBeenCalledWith({});
    });

    it('should return 200 even if revocation throws', async () => {
      mockOAuthService.revokeToken.mockRejectedValue(new Error('Redis down'));
      const res = mockResponse();

      await controller.revoke(
        {
          token: 'some-token',
          client_id: OAUTH_CLIENT_ID,
          client_secret: 'secret',
        },
        res as any,
      );

      expect(res.json).toHaveBeenCalledWith({});
    });
  });
});
