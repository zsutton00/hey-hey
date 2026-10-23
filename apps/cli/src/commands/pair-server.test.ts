import { afterEach, describe, expect, it, vi } from 'vitest';

import { runDefaultServer, terminalStreamFlags } from '../tui/interactive-terminal';
import { runPairCommand } from './pair';
import { PairServerCommand } from './pair-server';

vi.mock('./pair', () => ({
  runPairCommand: vi.fn(),
}));

vi.mock('../tui/interactive-terminal', () => ({
  runDefaultServer: vi.fn(),
  terminalStreamFlags: vi.fn(),
}));

const TTY = { stdin: true, stdout: true, stderr: true };

describe('PairServerCommand', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('enters the default server lifecycle in the same process after successful pairing', async () => {
    vi.mocked(runPairCommand).mockResolvedValue(true);
    vi.mocked(terminalStreamFlags).mockReturnValue(TTY);
    vi.mocked(runDefaultServer).mockResolvedValue(true);

    const ok = await new PairServerCommand().run({
      preferredPort: 4848,
      enableDailySession: true,
    });

    expect(ok).toBe(true);
    expect(runPairCommand).toHaveBeenCalledTimes(1);
    expect(runDefaultServer).toHaveBeenCalledWith(TTY, {
      preferredPort: 4848,
      enableDailySession: true,
    });
  });

  it('does not enter the server lifecycle when pairing fails', async () => {
    vi.mocked(runPairCommand).mockResolvedValue(false);

    const ok = await new PairServerCommand().run();

    expect(ok).toBe(false);
    expect(runDefaultServer).not.toHaveBeenCalled();
  });

  it('propagates a failed server result after successful pairing', async () => {
    vi.mocked(runPairCommand).mockResolvedValue(true);
    vi.mocked(runDefaultServer).mockResolvedValue(false);

    await expect(new PairServerCommand().run()).resolves.toBe(false);
  });

  it('reuses the default server entry after another command completes pairing', async () => {
    vi.mocked(terminalStreamFlags).mockReturnValue(TTY);
    vi.mocked(runDefaultServer).mockResolvedValue(true);

    await expect(
      new PairServerCommand().runServerAfterPairing({
        preferredPort: 5151,
        enableDailySession: true,
      }),
    ).resolves.toBe(true);

    expect(runDefaultServer).toHaveBeenCalledWith(TTY, {
      preferredPort: 5151,
      enableDailySession: true,
    });
  });
});
