import { describe, expect, it, vi } from 'vitest';
import { readHintsEnabled } from './hint-availability';

const toolList = (names: string[]) =>
  vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'hints-enabled',
        result: { tools: names.map((name) => ({ name })) },
      }),
    ),
  );

describe('readHintsEnabled', () => {
  it('is on when the platform offers create_hint', async () => {
    await expect(
      readHintsEnabled('token', 'project', toolList(['get_context', 'create_hint'])),
    ).resolves.toBe(true);
  });

  it('is off when the platform omits the hint tools', async () => {
    await expect(readHintsEnabled('token', 'project', toolList(['get_context']))).resolves.toBe(
      false,
    );
  });

  it('throws on a failed or malformed tool list', async () => {
    await expect(
      readHintsEnabled(
        'token',
        'project',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 })),
      ),
    ).rejects.toThrow('platform tool list failed (500)');
    await expect(
      readHintsEnabled(
        'token',
        'project',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('{"jsonrpc":"2.0"}')),
      ),
    ).rejects.toThrow('platform tool list was invalid');
  });
});
