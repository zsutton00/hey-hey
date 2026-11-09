import { describe, expect, it, vi } from 'vitest';
import { setTerminalTitle } from './terminal-title';

describe('setTerminalTitle', () => {
  it('writes and clears the title on a TTY, and stays silent without one', () => {
    const write = vi.fn(() => true);
    const registerExit = vi.fn<(handler: () => void) => void>();

    setTerminalTitle('local', 'work', { isTTY: true, write }, registerExit);

    expect(write).toHaveBeenCalledWith('\u001B]0;Hey Hey (local · work)\u0007');
    expect(registerExit).toHaveBeenCalledOnce();
    registerExit.mock.calls[0]?.[0]();
    expect(write).toHaveBeenLastCalledWith('\u001B]0;\u0007');

    const nonTtyWrite = vi.fn(() => true);
    const nonTtyRegisterExit = vi.fn<(handler: () => void) => void>();
    setTerminalTitle(
      'production',
      undefined,
      { isTTY: false, write: nonTtyWrite },
      nonTtyRegisterExit,
    );

    expect(nonTtyWrite).not.toHaveBeenCalled();
    expect(nonTtyRegisterExit).not.toHaveBeenCalled();
  });
});
