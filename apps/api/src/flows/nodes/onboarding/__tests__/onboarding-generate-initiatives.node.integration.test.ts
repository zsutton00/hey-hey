import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { OnboardingGenerateInitiativesNode } from '../onboarding-generate-initiatives.node';
import { InitiativeService } from '../../../../services/initiatives/initiative.service';
import { ConversationService } from '../../../../services/conversation.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TagService } from '../../../../services/tag.service';
import { InitiativeArtifactService } from '../../../../services/initiatives/initiative-artifact.service';
import { ArtifactService } from '../../../../services/artifacts/artifact.service';
import { ArtifactGraphService } from '../../../../services/artifacts/artifact-graph.service';
import { ArtifactDataService } from '../../../../services/artifacts/artifact-data.service';
import { ArtifactDataValidators } from '../../../../services/artifacts/artifact-data.validators';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../../core/events/tokens';
import {
  OrganizationId,
  ProjectId,
  ConversationId,
  UserId,
  WorkflowId,
  ArtifactId,
  WorkflowAboutType,
} from '../../../../types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import * as TestUtils from '../../../../utils/testUtils';
import { InitiativeDraft } from '../../../../services/initiatives/types';
import * as fs from 'fs';
import path from 'path';

// This suite relied on a full database + entity registry setup that no longer exists in unit tests.
// Keeping the file but skipping until a new integration harness is added.
describe.skip('OnboardingGenerateInitiativesNode Integration Test', () => {
  let fixtureData: { initiatives: InitiativeDraft[] };
  let module: TestingModule;
  let node: OnboardingGenerateInitiativesNode;
  let prisma: PrismaService;
  let mockConversationService: jest.Mocked<ConversationService>;
  let mockEventPublisher: jest.Mocked<any>;

  // Test IDs
  let testOrgId: OrganizationId;
  let testProjectId: ProjectId;
  let testConversationId: ConversationId;
  const testUserId: UserId = 'test-user-id' as UserId;
  const testWorkflowId: WorkflowId = 'test-workflow-id' as WorkflowId;

  // Artifact IDs from fixture (these must exist in DB before test)
  const fixtureArtifactIds = [
    'dba70346-ad80-43d1-ba4f-9ecdc3ce61c5',
    '343e77f0-f711-451d-9c8d-47601e4765cf',
    '4c6fb1aa-bbde-4aa3-8cf0-552f6dc496ae',
    'd31b0129-f875-4dec-8cb6-cd014dba883f',
  ];

  beforeAll(async () => {
    fixtureData = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures/generate-initiatives-llm-response.json'),
        'utf8',
      ),
    ) as { initiatives: InitiativeDraft[] };

    // Create mock services
    mockConversationService = {
      createConversation: jest.fn().mockResolvedValue({
        id: 'mock-conversation-id',
      }),
    } as unknown as jest.Mocked<ConversationService>;

    mockEventPublisher = {
      publish: jest.fn(),
      publishInTransaction: jest.fn(),
    };

    // Build testing module with real services
    module = await Test.createTestingModule({
      providers: [
        OnboardingGenerateInitiativesNode,
        PrismaService,
        InitiativeService,
        TagService,
        InitiativeArtifactService,
        ArtifactService,
        ArtifactGraphService,
        ArtifactDataService,
        ArtifactDataValidators,
        {
          provide: ConversationService,
          useValue: mockConversationService,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    node = module.get<OnboardingGenerateInitiativesNode>(
      OnboardingGenerateInitiativesNode,
    );
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await module.close();
  });

  beforeEach(async () => {
    // Clean up any existing test artifacts with fixture IDs from previous failed runs
    await prisma.db.artifact.deleteMany({
      where: {
        id: {
          in: fixtureArtifactIds,
        },
      },
    });

    // Create Organization
    const org = await prisma.db.organization.create({
      data: {
        name: 'Test Org',
        slug: `test-org-${Date.now()}`,
      },
    });
    testOrgId = org.id;

    // Create Project
    const project = await prisma.db.project.create({
      data: {
        name: 'Test Project',
        organizationId: testOrgId,
      },
    });
    testProjectId = project.id;

    // Create Conversation
    const conversation = await prisma.db.conversation.create({
      data: {
        projectId: testProjectId,
        organizationId: testOrgId,
        status: 'IN_PROGRESS',
        workflowName: 'ONBOARDING',
        initiatedBy: 'USER',
      },
    });
    testConversationId = conversation.id;

    // Create prerequisite artifacts with EXACT IDs from fixture
    for (const artifactId of fixtureArtifactIds) {
      await prisma.db.artifact.create({
        data: {
          id: artifactId,
          type: 'QA_PAIR',
          status: 'ACTIVE',
          projectId: testProjectId,
          organizationId: testOrgId,
          sourceType: 'CONVERSATION',
          sourceId: testConversationId,
          data: {
            type: 'QA_PAIR',
            question: 'Test question',
            answer: 'Test answer',
          },
        },
      });
    }
  });

  afterEach(async () => {
    // Clean up in reverse FK order
    await prisma.db.influence.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.db.artifact.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.db.tag.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.db.projectInitiative.deleteMany({
      where: { projectId: testProjectId },
    });
    await prisma.db.initiative.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.db.conversation.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.db.project.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.db.organization.deleteMany({
      where: { id: testOrgId },
    });
  });

  describe('processLlmResponse', () => {
    it('should create 6 INITIATIVE_ORIGINAL artifacts with 14 influences', async () => {
      const baseContext = TestUtils.createMockFlowContext();
      const context = TestUtils.createMockFlowContext({
        core: {
          ...baseContext.core,
          organizationId: testOrgId,
          projectId: testProjectId,
          conversationId: testConversationId,
          user: {
            id: testUserId,
            role: '',
          },
          workflowId: testWorkflowId,
          workflowAboutId: testProjectId,
          workflowAboutType: 'project' as WorkflowAboutType,
        },
      });
      const tracker = createMutableContextHandle(context);

      // Act: Call processLlmResponse with fixture data
      await node.processLlmResponse(
        { initiatives: fixtureData.initiatives, nodeId: node.id },
        undefined,
        tracker,
      );

      // Assert: Verify 6 INITIATIVE_ORIGINAL artifacts were created
      const artifacts = await prisma.db.artifact.findMany({
        where: {
          type: 'INITIATIVE_ORIGINAL',
          organizationId: testOrgId,
          projectId: testProjectId,
        },
      });

      expect(artifacts).toHaveLength(6);

      // Assert: Verify 14 Influence records were created
      const influences = await prisma.db.influence.findMany({
        where: {
          organizationId: testOrgId,
          influencedType: 'initiative',
          influencedId: {
            in: artifacts.map((a) => a.id),
          },
        },
      });

      expect(influences).toHaveLength(14);

      // Assert: Verify influence properties
      influences.forEach((influence) => {
        expect(influence.reasoning).toBeTruthy();
        expect(typeof influence.reasoning).toBe('string');
        expect(influence.reasonType).toBeTruthy();
        expect(typeof influence.reasonType).toBe('string');

        // Confidence can be null or a number between 0-1
        if (influence.confidence !== null) {
          expect(typeof influence.confidence).toBe('number');
          expect(influence.confidence).toBeGreaterThanOrEqual(0);
          expect(influence.confidence).toBeLessThanOrEqual(1);
        }
      });

      // Assert: Verify influencing artifacts are the conversation artifacts
      const influencingIds = influences.map((i) => i.influencingId);
      const allInfluencingIdsAreValid = influencingIds.every((id) =>
        fixtureArtifactIds.includes(id),
      );
      expect(allInfluencingIdsAreValid).toBe(true);

      // Assert: Verify influenced artifacts are the INITIATIVE_ORIGINAL artifacts
      const influencedIds = influences.map((i) => i.influencedId);
      const artifactIds = artifacts.map((a) => a.id);
      const allInfluencedIdsAreValid = influencedIds.every((id) =>
        artifactIds.includes(id as ArtifactId),
      );
      expect(allInfluencedIdsAreValid).toBe(true);
    }, 30000);

    it('should create initiatives with correct influence distribution', async () => {
      const baseContext = TestUtils.createMockFlowContext();
      const context = TestUtils.createMockFlowContext({
        core: {
          ...baseContext.core,
          organizationId: testOrgId,
          projectId: testProjectId,
          conversationId: testConversationId,
          user: {
            id: testUserId,
            role: '',
          },
          workflowId: testWorkflowId,
          workflowAboutId: testProjectId,
          workflowAboutType: 'project' as WorkflowAboutType,
        },
      });
      const tracker = createMutableContextHandle(context);

      // Act
      await node.processLlmResponse(
        { initiatives: fixtureData.initiatives, nodeId: node.id },
        undefined,
        tracker,
      );

      // Assert: Verify influence counts per initiative by matching on initiative name
      const initiatives = await prisma.db.initiative.findMany({
        where: {
          organizationId: testOrgId,
        },
      });

      // Map fixture initiatives to their expected influence counts
      const expectedCountsByName = new Map([
        ['LLM Reliability & Prompt Engineering Framework', 2],
        ['RAG System Implementation for Project Context', 3],
        ['Agent Framework for Long-Running Tasks', 3],
        ['GitHub Integration & Code Validation Pipeline', 2],
        ['Design Consistency Detection & Alert System', 2],
        ['MCP Server for Agentic Coding Tool Integration', 2],
      ]);

      // For each initiative, find its artifact and verify influence count
      for (const initiative of initiatives) {
        const artifacts = await prisma.db.artifact.findMany({
          where: {
            sourceId: initiative.id,
            type: 'INITIATIVE_ORIGINAL',
            organizationId: testOrgId,
          },
        });

        expect(artifacts).toHaveLength(1);

        const [artifact] = artifacts;
        if (!artifact) {
          throw new Error('Expected initiative artifact');
        }

        const influences = await prisma.db.influence.findMany({
          where: {
            influencedType: 'initiative',
            influencedId: artifact.id,
            organizationId: testOrgId,
          },
        });

        const expectedCount = expectedCountsByName.get(initiative.name);
        if (expectedCount === undefined) {
          throw new Error(`Missing expected count for ${initiative.name}`);
        }
        expect(influences).toHaveLength(expectedCount);
      }
    }, 30000);

    it('should create initiatives in database', async () => {
      const baseContext = TestUtils.createMockFlowContext();
      const context = TestUtils.createMockFlowContext({
        core: {
          ...baseContext.core,
          organizationId: testOrgId,
          projectId: testProjectId,
          conversationId: testConversationId,
          user: {
            id: testUserId,
            role: '',
          },
          workflowId: testWorkflowId,
          workflowAboutId: testProjectId,
          workflowAboutType: 'project' as WorkflowAboutType,
        },
      });
      const tracker = createMutableContextHandle(context);

      // Act
      await node.processLlmResponse(
        { initiatives: fixtureData.initiatives, nodeId: node.id },
        undefined,
        tracker,
      );

      // Assert: Verify 6 initiatives were created
      const initiatives = await prisma.db.initiative.findMany({
        where: {
          organizationId: testOrgId,
        },
      });

      expect(initiatives).toHaveLength(6);

      // Assert: Verify initiative names match fixture
      const expectedNames = fixtureData.initiatives.map(
        (i: unknown) => (i as { name: string }).name,
      );
      const actualNames = initiatives.map((i) => i.name);

      expectedNames.forEach((name: string) => {
        expect(actualNames).toContain(name);
      });
    }, 30000);
  });
});
