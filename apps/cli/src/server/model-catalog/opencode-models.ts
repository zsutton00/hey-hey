import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  OPENCODE_DEFAULT_MODEL_ID,
  type CapabilityCatalogModel,
} from '@hey-hey/ui-common/capability-catalog';
import {
  OpenCodeServerProcess,
  resolveOpencodeBinary,
} from '../../agents/providers/opencode/opencode-server-launcher';
import { ProviderNotInstalledError, isMissingExecutable } from './provider-process';
import type {
  ProviderModelReader,
  ProviderModelsReport,
  SkippedProviderEntry,
} from './provider-models';

const providersResponseSchema = z.object({ providers: z.array(z.unknown()) }).passthrough();

const providerSchema = z
  .object({ id: z.string().min(1), models: z.record(z.unknown()) })
  .passthrough();

const modelSchema = z
  .object({
    name: z.string().min(1),
    variants: z.record(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Maps OpenCode's `/config/providers` (only the providers connected on this
 * machine) to catalog models. Model names repeat across providers, so the row
 * id is `providerID/modelID`; the launch reference is the pair itself. A model
 * that cannot be used is skipped on its own.
 */
export const opencodeModelsFromProviders = (
  response: z.infer<typeof providersResponseSchema>,
): ProviderModelsReport => {
  const models: CapabilityCatalogModel[] = [];
  const skipped: SkippedProviderEntry[] = [];
  for (const rawProvider of response.providers) {
    const provider = providerSchema.safeParse(rawProvider);
    if (!provider.success) {
      skipped.push({ what: 'an OpenCode provider entry', why: provider.error.message });
      continue;
    }
    for (const [modelID, raw] of Object.entries(provider.data.models)) {
      const model = modelSchema.safeParse(raw);
      if (!model.success) {
        skipped.push({
          what: `OpenCode model ${provider.data.id}/${modelID}`,
          why: model.error.message,
        });
        continue;
      }
      models.push({
        id: `${provider.data.id}/${modelID}`,
        label: model.data.name,
        efforts: Object.keys(model.data.variants ?? {}),
        opencodeModelRef: { providerID: provider.data.id, modelID },
      });
    }
  }
  models.push({ id: OPENCODE_DEFAULT_MODEL_ID, label: 'Default', efforts: [] });
  return { models, skipped };
};

export class OpenCodeModelReader implements ProviderModelReader {
  public readonly provider = 'opencode';
  public readonly displayName = 'OpenCode';

  public async readModels(): Promise<ProviderModelsReport> {
    const directory = await mkdtemp(join(tmpdir(), 'heyhey-model-catalog-'));
    try {
      const server = await OpenCodeServerProcess.launch({ directory }).catch((error: unknown) => {
        if (error instanceof Error && isMissingExecutable(error.cause)) {
          throw new ProviderNotInstalledError(this.displayName, resolveOpencodeBinary());
        }
        throw error;
      });
      try {
        const response = await fetch(`${server.baseUrl}/config/providers`);
        if (!response.ok) {
          throw new Error(
            `OpenCode's /config/providers request failed: ${String(response.status)} ${await response
              .text()
              .catch(() => '')}`,
          );
        }
        const parsed = providersResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error(
            `OpenCode's /config/providers response was not recognized: ${parsed.error.message}`,
          );
        }
        return opencodeModelsFromProviders(parsed.data);
      } finally {
        await server.stop();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
