import { afterEach, expect, it, vi } from 'vitest';
import { LocalPasskeyRepair } from './local-passkey-repair';

const SECRET = 'installation-secret';

/** The local API as the CLI sees it: one repair state, changed by the decision. */
const stubInstallation = (initialState: string) => {
  let state = initialState;
  const decisions: unknown[] = [];
  const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
    if (new Headers(init.headers).get('X-HeyHey-Local-Secret') !== SECRET) {
      return new Response('{"message":"Local machine authority is required"}', { status: 401 });
    }
    if (url.endsWith('/repair/decision')) {
      const decision = JSON.parse(String(init.body)) as { approved: boolean };
      decisions.push(decision);
      state = decision.approved ? 'COMPLETED' : 'DECLINED';
    }
    return new Response(JSON.stringify({ success: true, data: { state } }));
  });
  vi.stubGlobal('fetch', fetchStub);

  return { decisions };
};

const terminal = () => ({ pause: vi.fn(), resume: vi.fn() });

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  { answer: true, said: 'Repaired' },
  { answer: false, said: 'Nothing was changed' },
])(
  'asks at the terminal before reporting a requested repair as approved=$answer',
  async ({ answer, said }) => {
    const installation = stubInstallation('REQUESTED');
    const prompter = { confirm: vi.fn().mockResolvedValue(answer) };
    const reader = terminal();
    const log = vi.fn();

    await new LocalPasskeyRepair(SECRET, prompter, reader, log).check();

    expect(prompter.confirm).toHaveBeenCalledTimes(1);
    expect(installation.decisions).toEqual([{ approved: answer }]);
    expect(reader.pause).toHaveBeenCalledTimes(1);
    expect(reader.resume).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join('\n')).toContain(said);
  },
);

it('neither asks nor decides when no repair was requested', async () => {
  const installation = stubInstallation('NONE');
  const prompter = { confirm: vi.fn() };
  const reader = terminal();

  await new LocalPasskeyRepair(SECRET, prompter, reader).check();

  expect(prompter.confirm).not.toHaveBeenCalled();
  expect(installation.decisions).toEqual([]);
  expect(reader.pause).not.toHaveBeenCalled();
});

it('reports why the installation refused, once, and decides nothing', async () => {
  const installation = stubInstallation('REQUESTED');
  const prompter = { confirm: vi.fn() };
  const logError = vi.fn();
  const repair = new LocalPasskeyRepair('wrong-secret', prompter, terminal(), vi.fn(), logError);

  await repair.check();
  await repair.check();

  expect(prompter.confirm).not.toHaveBeenCalled();
  expect(installation.decisions).toEqual([]);
  expect(logError).toHaveBeenCalledTimes(1);
  expect(logError.mock.calls[0]![0]).toContain('HTTP 401');
});

it('dismisses a request left by an earlier run instead of asking about it', async () => {
  const installation = stubInstallation('REQUESTED');
  const prompter = { confirm: vi.fn() };
  const repair = new LocalPasskeyRepair(SECRET, prompter, terminal(), vi.fn());

  await repair.watch();
  repair.stop();

  expect(prompter.confirm).not.toHaveBeenCalled();
  expect(installation.decisions).toEqual([{ approved: false }]);
});
