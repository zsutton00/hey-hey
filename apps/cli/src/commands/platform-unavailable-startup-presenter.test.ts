import { describe, expect, it, vi } from 'vitest';
import { PlatformUnavailableStartupError } from '../server/startup-readiness';
import { PlatformUnavailableStartupPresenter } from './platform-unavailable-startup-presenter';

describe('PlatformUnavailableStartupPresenter', () => {
  it('renders local development-server guidance without generic error output', async () => {
    const output = { log: vi.fn() };
    const error = new PlatformUnavailableStartupError(
      'http://localhost:3000/api/v1',
      new Error('connect ECONNREFUSED'),
    );

    await new PlatformUnavailableStartupPresenter(output).present(error);

    expect(output.log).toHaveBeenCalledWith(
      '+--------------------------------------------------------------------+\n| Local Hey Hey is unavailable                                       |\n|                                                                    |\n| Start the Hey Hey development server, then run this command again. |\n+--------------------------------------------------------------------+',
    );
  });
});
