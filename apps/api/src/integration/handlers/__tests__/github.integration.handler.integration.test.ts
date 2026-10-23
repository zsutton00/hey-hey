import { Test, TestingModule } from '@nestjs/testing';
import { GitHubIntegrationHandler } from '../github.integration.handler';
import { ConfigEncryptionService } from '../../../services/config-encryption.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmbeddingsClientService } from '../../../services/embeddings-client.service';
import { IntegrationType } from '../../../generated';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';

describe('GitHubIntegrationHandler - Integration Tests', () => {
  let handler: GitHubIntegrationHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubIntegrationHandler,
        {
          provide: ConfigEncryptionService,
          useValue: {
            decryptConfig: jest.fn().mockResolvedValue({
              token: 'github-token-123',
              owner: 'testowner',
              repositoryUrl: 'https://github.com/testowner/testrepo',
            }),
          },
        },
        {
          provide: ArtifactService,
          useValue: {
            createMany: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: EmbeddingsClientService,
          useValue: {},
        },
        {
          provide: DomainEventPublisher,
          useValue: { publishInTransaction: jest.fn() },
        },
      ],
    }).compile();

    handler = module.get<GitHubIntegrationHandler>(GitHubIntegrationHandler);
  });

  describe('Core functionality', () => {
    it('should be defined', () => {
      expect(handler).toBeDefined();
    });

    it('should return correct integration type', () => {
      expect(handler.getIntegrationType()).toBe(IntegrationType.Github);
    });

    it('should return required config fields', () => {
      const fields = handler.getRequiredConfigFields();
      expect(fields).toEqual(['token', 'owner OR repositoryUrl']);
    });

    it('should validate configuration correctly', async () => {
      const validConfig = {
        token: 'github-token',
        owner: 'testowner',
      };

      const invalidConfig = {
        owner: 'testowner',
        // missing token
      };

      expect(await handler.validateConfig(validConfig)).toBe(true);
      expect(await handler.validateConfig(invalidConfig)).toBe(false);
    });
  });

  describe('Parsing utilities', () => {
    it('should parse GitHub repository URLs correctly', () => {
      const parseMethod = (handler as any).parseRepositoryUrl.bind(handler);

      expect(parseMethod('https://github.com/owner/repo')).toEqual({
        owner: 'owner',
        repo: 'repo',
      });

      expect(parseMethod('https://github.com/owner/repo.git')).toEqual({
        owner: 'owner',
        repo: 'repo',
      });

      expect(parseMethod('git@github.com:owner/repo.git')).toEqual({
        owner: 'owner',
        repo: 'repo',
      });

      expect(parseMethod('owner/repo')).toEqual({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('should throw error for invalid repository URLs', () => {
      const parseMethod = (handler as any).parseRepositoryUrl.bind(handler);

      expect(() => parseMethod('invalid-url')).toThrow(
        'Invalid repository URL format',
      );
      expect(() => parseMethod('https://github.com/owner')).toThrow(
        'Invalid repository URL format',
      );
    });
  });

  describe('Content extraction', () => {
    it('should extract linked issues from text', () => {
      const extractMethod = (handler as any).extractLinkedIssues.bind(handler);

      const prBody = 'This PR fixes #123 and resolves #456';
      const comments = [{ body: 'Also closes #789' }];

      const result = extractMethod(prBody, comments);

      expect(result).toEqual(['123', '456', '789']);
    });

    it('should extract external links', () => {
      const extractMethod = (handler as any).extractExternalLinks.bind(handler);

      const prBody =
        'See https://jira.company.com/PROJ-123 and https://linear.app/issue/456';
      const comments = [{ body: 'Related: https://notion.so/page/789' }];

      const result = extractMethod(prBody, comments);

      expect(result).toEqual([
        'https://jira.company.com/PROJ-123',
        'https://linear.app/issue/456',
        'https://notion.so/page/789',
      ]);
    });

    it('should filter out GitHub links from external links', () => {
      const extractMethod = (handler as any).extractExternalLinks.bind(handler);

      const prBody =
        'See https://github.com/owner/repo/issues/123 and https://jira.company.com/PROJ-456';
      const comments = [] as any[];

      const result = extractMethod(prBody, comments);

      expect(result).toEqual(['https://jira.company.com/PROJ-456']);
    });
  });

  describe('Content formatting', () => {
    it('should format issue content with all details', () => {
      const formatMethod = (handler as any).formatIssueContent.bind(handler);

      const issue = {
        number: 42,
        title: 'Critical Bug',
        body: 'This is a critical bug that needs fixing',
        state: 'open',
        author: { login: 'reporter' },
        createdAt: '2023-12-01T10:00:00Z',
        labels: { nodes: [{ name: 'bug' }, { name: 'critical' }] },
        assignees: { nodes: [{ login: 'developer' }] },
        comments: { totalCount: 3 },
        closedAt: null as string | null,
      };

      const result = formatMethod(issue);

      expect(result).toContain('Issue #42: Critical Bug');
      expect(result).toContain('This is a critical bug that needs fixing');
      expect(result).toContain('State: open');
      expect(result).toContain('Author: reporter');
      expect(result).toContain('Labels: bug, critical');
      expect(result).toContain('Assignees: developer');
    });

    it('should format PR content with files and discussion', () => {
      const formatMethod = (handler as any).formatPullRequestContent.bind(
        handler,
      );

      const pr = {
        number: 15,
        title: 'Add new feature',
        body: 'This PR adds the requested feature',
        state: 'merged',
        author: { login: 'developer' },
        createdAt: '2023-12-01T10:00:00Z',
        baseRefName: 'main',
        headRefName: 'feature-branch',
        additions: 100,
        deletions: 20,
        changedFiles: 2,
        mergedAt: '2023-12-02T15:30:00Z',
        files: {
          nodes: [
            {
              path: 'src/feature.js',
              changeType: 'added',
              additions: 80,
              deletions: 0,
            },
            {
              path: 'tests/feature.test.js',
              changeType: 'added',
              additions: 20,
              deletions: 0,
            },
          ],
        },
        comments: {
          nodes: [
            {
              author: { login: 'reviewer' },
              body: 'Great work! LGTM',
            },
          ],
        },
      };

      const result = formatMethod(pr);

      expect(result).toContain('Pull Request #15: Add new feature');
      expect(result).toContain('This PR adds the requested feature');
      expect(result).toContain('State: merged');
      expect(result).toContain('Base branch: main');
      expect(result).toContain('Head branch: feature-branch');
      expect(result).toContain('Files changed: 2');
      expect(result).toContain('Additions: 100');
      expect(result).toContain('Deletions: 20');
      expect(result).toContain('Changed Files:');
      expect(result).toContain('src/feature.js (added): +80 -0');
      expect(result).toContain('tests/feature.test.js (added): +20 -0');
      expect(result).toContain('Discussion:');
      expect(result).toContain('reviewer: Great work! LGTM');
    });
  });
});
