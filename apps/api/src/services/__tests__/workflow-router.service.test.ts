import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowRouterService } from '../workflows/workflow-router.service';
import { WorkflowTypeRegistryService } from '../workflows/workflow-type-registry.service';
import { ConversationService } from '../conversation.service';
import * as TestUtils from '../../utils/testUtils';
const { testIds } = TestUtils;

describe('WorkflowRouterService', () => {
  let service: WorkflowRouterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRouterService,
        {
          provide: 'TEMPORAL_CLIENT',
          useValue: {
            workflow: {
              signalWithStart: jest.fn(),
              getHandle: jest.fn().mockReturnValue({
                signal: jest.fn(),
                describe: jest.fn(),
              }),
            },
          },
        },
        {
          provide: WorkflowTypeRegistryService,
          useValue: TestUtils.createMockWorkflowTypeRegistryService(),
        },
        {
          provide: ConversationService,
          useValue: TestUtils.createMockConversationService(),
        },
      ],
    }).compile();

    service = module.get<WorkflowRouterService>(WorkflowRouterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('workflow routing', () => {
    it('should be instantiated correctly', () => {
      expect(service).toBeInstanceOf(WorkflowRouterService);
    });

    it('should be ready for workflow operations', () => {
      expect(typeof service).toBe('object');
      expect(service).toBeTruthy();
    });
  });
});
