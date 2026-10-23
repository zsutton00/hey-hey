import { describe, expect, it, vi } from 'vitest';
import {
  CommonCliScenarioView,
  type PairingRequiredScenario,
  type PlatformUnavailableScenario,
} from './common-cli-scenario-view';

const scenario = {
  kind: 'pairing-required',
  heading: 'Pairing required',
  body: 'Hey Hey no longer recognizes this machine. Pair it again to continue.',
  primaryAction: { kind: 'pair-now', label: 'Pair Now' },
} satisfies PairingRequiredScenario;

describe('CommonCliScenarioView', () => {
  it('renders supplied scenario copy and invokes the supplied Pair Now callback', async () => {
    const output = { log: vi.fn() };
    const prompter = { confirm: vi.fn().mockResolvedValue(true) };
    const onPairNow = vi.fn().mockResolvedValue(true);

    const result = await new CommonCliScenarioView(output, prompter).render({
      scenario,
      onPairNow,
    });

    expect(result).toBe(true);
    expect(output.log).toHaveBeenCalledWith(
      '+-----------------------------------------------------------------------+\n| Pairing required                                                      |\n|                                                                       |\n| Hey Hey no longer recognizes this machine. Pair it again to continue. |\n+-----------------------------------------------------------------------+',
    );
    expect(prompter.confirm).toHaveBeenCalledWith('Pair Now?', false);
    expect(onPairNow).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the action callback when Pair Now is declined', async () => {
    const output = { log: vi.fn() };
    const prompter = { confirm: vi.fn().mockResolvedValue(false) };
    const onPairNow = vi.fn().mockResolvedValue(true);

    const result = await new CommonCliScenarioView(output, prompter).render({
      scenario,
      onPairNow,
    });

    expect(result).toBe(false);
    expect(output.log).toHaveBeenCalledTimes(1);
    expect(onPairNow).not.toHaveBeenCalled();
  });

  it('returns a failed action result without adding lifecycle output', async () => {
    const output = { log: vi.fn() };
    const prompter = { confirm: vi.fn().mockResolvedValue(true) };
    const onPairNow = vi.fn().mockResolvedValue(false);

    const result = await new CommonCliScenarioView(output, prompter).render({
      scenario,
      onPairNow,
    });

    expect(result).toBe(false);
    expect(output.log).toHaveBeenCalledTimes(1);
    expect(onPairNow).toHaveBeenCalledTimes(1);
  });

  it('renders an informational scenario without prompting for an action', async () => {
    const output = { log: vi.fn() };
    const prompter = { confirm: vi.fn().mockResolvedValue(true) };
    const unavailable = {
      kind: 'platform-unavailable',
      heading: 'Local Hey Hey is unavailable',
      body: 'Start the Hey Hey development server, then run this command again.',
    } satisfies PlatformUnavailableScenario;

    const result = await new CommonCliScenarioView(output, prompter).render({
      scenario: unavailable,
    });

    expect(result).toBe(false);
    expect(output.log).toHaveBeenCalledWith(
      '+--------------------------------------------------------------------+\n| Local Hey Hey is unavailable                                       |\n|                                                                    |\n| Start the Hey Hey development server, then run this command again. |\n+--------------------------------------------------------------------+',
    );
    expect(prompter.confirm).not.toHaveBeenCalled();
  });
});
