import { Prisma } from '@prisma/client';
import { LLMTrackingService } from '../llm-tracking.service';

describe('LLMTrackingService', () => {
  const mockPrisma = {
    db: {
      lLMPromptResponse: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    },
  } as any;

  const service = new LLMTrackingService(mockPrisma);

  const duplicateRequestIdError = () =>
    new Prisma.PrismaClientKnownRequestError('duplicate request id', {
      code: 'P2002',
      clientVersion: 'test',
      meta: {
        target: ['request_id'],
      },
    });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('reuses existing row when prompt start hits duplicate requestId', async () => {
    mockPrisma.db.lLMPromptResponse.create.mockRejectedValueOnce(
      duplicateRequestIdError(),
    );
    mockPrisma.db.lLMPromptResponse.findUnique.mockResolvedValueOnce({
      id: 'existing-start-id',
    });

    const id = await service.recordPromptStart({
      requestId: 'req-1' as any,
      organizationId: 'org-1' as any,
      provider: 'claude',
      model: 'claude-haiku-4-5',
      stream: false,
      prompt: 'test prompt',
    });

    expect(id).toBe('existing-start-id');
    expect(mockPrisma.db.lLMPromptResponse.findUnique).toHaveBeenCalledWith({
      where: { requestId: 'req-1' },
      select: { id: true },
    });
  });

  it('updates existing row when recordPromptResponse hits duplicate requestId', async () => {
    mockPrisma.db.lLMPromptResponse.create.mockRejectedValueOnce(
      duplicateRequestIdError(),
    );
    mockPrisma.db.lLMPromptResponse.findUnique.mockResolvedValueOnce({
      id: 'existing-response-id',
    });
    mockPrisma.db.lLMPromptResponse.update.mockResolvedValueOnce({
      id: 'existing-response-id',
    });

    const id = await service.recordPromptResponse({
      requestId: 'req-2' as any,
      organizationId: 'org-1' as any,
      provider: 'claude',
      model: 'claude-haiku-4-5',
      stream: false,
      prompt: 'test prompt',
      responseContent: '{"ok":true}',
      success: true,
      totalTokens: 123,
      totalCost: 0.0123 as any,
    });

    expect(id).toBe('existing-response-id');
    expect(mockPrisma.db.lLMPromptResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-response-id' },
        data: expect.objectContaining({
          requestId: 'req-2',
          totalTokens: 123,
        }),
      }),
    );
  });
});
