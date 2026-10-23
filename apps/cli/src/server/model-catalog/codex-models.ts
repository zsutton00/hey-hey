import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { CapabilityCatalogModel } from '@hey-hey/ui-common/capability-catalog';
import { JsonLineProcess } from './provider-process';
import type {
  ProviderModelReader,
  ProviderModelsReport,
  SkippedProviderEntry,
} from './provider-models';

const REQUEST_TIMEOUT_MS = 30_000;
const FAST_MODE_SERVICE_TIER_ID = 'priority';

const codexModelSchema = z
  .object({
    model: z.string().min(1),
    displayName: z.string().min(1),
    hidden: z.boolean(),
    supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() }).passthrough()),
    serviceTiers: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  })
  .passthrough();

const modelListResponseSchema = z.object({
  id: z.number(),
  result: z
    .object({ data: z.array(z.unknown()), nextCursor: z.string().nullable().optional() })
    .passthrough(),
});

const rpcErrorSchema = z.object({
  id: z.number(),
  error: z.object({ message: z.string().optional() }).passthrough(),
});

const matchesResponse =
  (id: number) =>
  (message: unknown): boolean =>
    typeof message === 'object' &&
    message !== null &&
    'id' in message &&
    message.id === id &&
    ('result' in message || 'error' in message);

/** Maps one `model/list` entry; hidden models are not offered. */
export const codexModelToCatalogModel = (
  model: z.infer<typeof codexModelSchema>,
): CapabilityCatalogModel => ({
  id: model.model,
  label: model.displayName,
  efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
  ...(model.serviceTiers?.some((tier) => tier.id === FAST_MODE_SERVICE_TIER_ID)
    ? { serviceTiers: ['priority'] as const }
    : {}),
});

export class CodexModelReader implements ProviderModelReader {
  public readonly provider = 'codex';
  public readonly displayName = 'Codex';

  public async readModels(): Promise<ProviderModelsReport> {
    const codex = new JsonLineProcess(this.displayName, 'codex', ['app-server'], {
      cwd: tmpdir(),
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
      ),
    });
    let requestId = 0;
    const request = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
      const id = ++requestId;
      const answer = codex.expect(method, matchesResponse(id), REQUEST_TIMEOUT_MS);
      codex.send({ id, method, params });
      const message = await answer;
      const failure = rpcErrorSchema.safeParse(message);
      if (failure.success) {
        throw new Error(
          `Codex ${method} failed: ${failure.data.error.message ?? 'no reason given'}`,
        );
      }
      return message;
    };
    try {
      await request('initialize', {
        clientInfo: {
          name: 'hey_hey_cli_model_catalog',
          title: 'Hey Hey CLI Model Catalog',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      codex.send({ method: 'initialized' });

      const models: CapabilityCatalogModel[] = [];
      const skipped: SkippedProviderEntry[] = [];
      let cursor: string | null = null;
      do {
        const parsed = modelListResponseSchema.safeParse(
          await request('model/list', cursor === null ? {} : { cursor }),
        );
        if (!parsed.success) {
          throw new Error(
            `Codex's model/list response was not recognized: ${parsed.error.message}`,
          );
        }
        for (const raw of parsed.data.result.data) {
          const entry = codexModelSchema.safeParse(raw);
          if (!entry.success) {
            skipped.push({ what: 'a Codex model entry', why: entry.error.message });
          } else if (!entry.data.hidden) {
            models.push(codexModelToCatalogModel(entry.data));
          }
        }
        cursor = parsed.data.result.nextCursor ?? null;
      } while (cursor !== null);
      return { models, skipped };
    } finally {
      await codex.dispose();
    }
  }
}
