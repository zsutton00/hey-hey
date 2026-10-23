import { startApiProcessSampling } from '../api-process-sampling';

describe('API process interval sampling', () => {
  afterEach(() => jest.useRealTimers());

  it('emits aggregate timing without request data and stops on shutdown', () => {
    jest.useFakeTimers();
    const emit = jest.fn();
    const stop = startApiProcessSampling(emit);
    jest.advanceTimersByTime(5000);
    expect(emit).toHaveBeenCalledTimes(1);
    const record = emit.mock.calls[0][0];
    expect(record.message).toBe('API diagnostic process interval');
    expect(record.gcCount).toBeGreaterThanOrEqual(0);
    expect(record).not.toHaveProperty('requestId');
    expect(record).not.toHaveProperty('payload');
    stop();
    jest.advanceTimersByTime(5000);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
