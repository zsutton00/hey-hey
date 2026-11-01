describe('Jest generated-source locking', () => {
  it('holds the generation lock until global teardown', async () => {
    const release = jest.fn();
    const acquireModelGenerationLock = jest.fn().mockResolvedValue({ release });
    const sharedGlobal = global as typeof global & {
      __jestModelGenerationLock?: unknown;
    };
    const originalLock = sharedGlobal.__jestModelGenerationLock;

    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('../../../scripts/model-generation-lock', () => ({
          acquireModelGenerationLock,
        }));
        const setup = require('../../../scripts/jest-model-generation-setup');
        const teardown = require('../../../scripts/jest-model-generation-teardown');

        await setup();
        expect(acquireModelGenerationLock).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();

        await teardown();
        expect(release).toHaveBeenCalledTimes(1);
        expect(sharedGlobal.__jestModelGenerationLock).toBeUndefined();
      });
    } finally {
      sharedGlobal.__jestModelGenerationLock = originalLock;
      jest.dontMock('../../../scripts/model-generation-lock');
    }
  });
});
