import { describe, expect, it, vi } from 'vitest';
import { readHintAvailability } from './hint-availability';

const toolList = (names: string[], meta?: Record<string, unknown>) =>
  vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'hints-enabled',
        result: { tools: names.map((name) => ({ name, ...(meta ? { _meta: meta } : {}) })) },
      }),
    ),
  );

describe('readHintAvailability', () => {
  it('is on when the platform offers create_hint', async () => {
    await expect(
      readHintAvailability('token', 'project', toolList(['get_context', 'create_hint'])),
    ).resolves.toMatchObject({ enabled: true });
  });

  it.each([
    [{ 'heyhey/productDevelopment': true }, true],
    [{ 'heyhey/productDevelopment': false }, false],
    [{ 'heyhey/productDevelopment': 'true' }, false],
    [undefined, false],
  ])('reads the product-development marker %j as %s', async (meta, expected) => {
    await expect(
      readHintAvailability('token', 'project', toolList(['create_hint'], meta)),
    ).resolves.toEqual({ enabled: true, productDevelopment: expected });
  });

  it('is off when the platform omits the hint tools', async () => {
    await expect(
      readHintAvailability('token', 'project', toolList(['get_context'])),
    ).resolves.toEqual({ enabled: false, productDevelopment: false });
  });

  it('throws on a failed or malformed tool list', async () => {
    await expect(
      readHintAvailability(
        'token',
        'project',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 })),
      ),
    ).rejects.toThrow('platform tool list failed (500)');
    await expect(
      readHintAvailability(
        'token',
        'project',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('{"jsonrpc":"2.0"}')),
      ),
    ).rejects.toThrow('platform tool list was invalid');
  });
});
