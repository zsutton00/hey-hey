import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
/* eslint-disable @typescript-eslint/unbound-method */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { IntegrationService } from '../../services/integrations/integration.service';
import { GitHubOAuthService } from '../../services/integrations/github-oauth.service';
import { ConnectionTestService } from '../../services/connection-test.service';
import { UserSuggestionService } from '../../services/user-suggestion.service';
import { GitHubRepositoryService } from '../../services/integrations/github-repository.service';
import { IntegrationController } from '../integration.controller';
import { IntegrationConnectionStatus } from '../../generated';

describe('GitHub OAuth Integration Callback (Integration Test)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let integrationService: IntegrationService;
  let githubOAuthService: GitHubOAuthService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [IntegrationController],
      providers: [
        {
          provide: IntegrationService,
          useValue: {
            storeGitHubOAuthTokens: jest.fn(),
            updateConnectionStatus: jest.fn(),
          },
        },
        {
          provide: GitHubOAuthService,
          useValue: {
            parseState: jest.fn(),
            exchangeCodeForToken: jest.fn(),
          },
        },
        {
          provide: ConnectionTestService,
          useValue: { testConnection: jest.fn() },
        },
        {
          provide: UserSuggestionService,
          useValue: { getSuggestedUsers: jest.fn() },
        },
        {
          provide: GitHubRepositoryService,
          useValue: { listRepositoriesForIntegration: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();

    integrationService = module.get<IntegrationService>(IntegrationService);
    githubOAuthService = module.get<GitHubOAuthService>(GitHubOAuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redirects to the app after successful OAuth exchange', async () => {
    const previousApiBaseUrl = process.env.API_BASE_URL;
    const previousAppBaseUrl = process.env.APP_BASE_URL;
    process.env.API_BASE_URL = 'http://api.test';
    process.env.APP_BASE_URL = 'http://app.test';

    jest.spyOn(githubOAuthService, 'parseState').mockReturnValue({
      integrationId: 'integration-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      nonce: 'nonce',
      issuedAt: Date.now(),
    });

    jest.spyOn(githubOAuthService, 'exchangeCodeForToken').mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    jest
      .spyOn(integrationService, 'storeGitHubOAuthTokens')
      .mockResolvedValue({} as never);

    await request(app.getHttpServer())
      .get(
        '/api/v1/organizations/org-1/projects/project-1/integrations/github/callback?code=code-123&state=state-123',
      )
      .expect(302)
      .expect('Location', 'http://app.test/projects/project-1');

    expect(githubOAuthService.exchangeCodeForToken).toHaveBeenCalled();
    expect(integrationService.storeGitHubOAuthTokens).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      'integration-1',
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
    );

    if (previousApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = previousApiBaseUrl;
    }

    if (previousAppBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousAppBaseUrl;
    }
  });

  it('marks connection as error when GitHub returns an OAuth error', async () => {
    jest.spyOn(githubOAuthService, 'parseState').mockReturnValue({
      integrationId: 'integration-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      nonce: 'nonce',
      issuedAt: Date.now(),
    });

    await request(app.getHttpServer())
      .get(
        '/api/v1/organizations/org-1/projects/project-1/integrations/github/callback?error=access_denied&state=state-123',
      )
      .expect(400);

    expect(integrationService.updateConnectionStatus).toHaveBeenCalledWith(
      'integration-1',
      IntegrationConnectionStatus.Error,
      'access_denied',
    );
  });
});
