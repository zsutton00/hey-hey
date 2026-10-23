import { ConversationPhaseProjection } from '../conversation-phase-projection.service';

function makeHarness() {
  const redis = {
    eval: jest.fn(),
  };
  const service = new ConversationPhaseProjection({
    getClient: () => redis,
  } as any);
  return { service, redis };
}

describe('ConversationPhaseProjection', () => {
  it('handles an empty lease index without treating it as an object', async () => {
    const { service, redis } = makeHarness();
    redis.eval.mockResolvedValueOnce(JSON.stringify([]));

    await expect(service.sweepExpiredLeases()).resolves.toBe(0);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0][0]).toContain(
      "if #members == 0 then\n  return '[]'",
    );
  });
});
