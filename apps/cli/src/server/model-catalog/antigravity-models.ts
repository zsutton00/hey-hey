import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  AntigravityAcpClient,
  AcpRequestError,
} from '../../agents/providers/antigravity/acp-client';
import { acpResultSchemas } from '../../agents/providers/antigravity/acp-schemas';
import {
  AntigravityNotReadyError,
  classifyAntigravityFailure,
} from '../../agents/providers/antigravity/antigravity-readiness';
import type { CapabilityCatalogModel } from '../../shared/runtime/components/AgentSession/capabilityCatalog';
import { NOOP_LOGGER } from '../logger';
import { ProviderNotInstalledError, isMissingExecutable } from './provider-process';
import type {
  ProviderModelReader,
  ProviderModelsReport,
  SkippedProviderEntry,
} from './provider-models';

type NewSessionResult = z.infer<(typeof acpResultSchemas)['session/new']>;

/**
 * Maps what `agy acp` reports at `session/new` to catalog models. `agy` has no
 * shell command that lists models (print-mode `/models` answers in prose), so the
 * ACP session is the only machine-readable source.
 *
 * The `model` config option lists the families; `availableModels` lists every
 * launchable `<family>-<level>` id; the `thought_level` config option lists the
 * levels. A family's efforts are the levels that actually exist for it, so a
 * family without levels (Orchestrator, GPT-OSS) has none.
 *
 * Levels map one-to-one onto the shared effort enum (`low`, `medium`, `high`,
 * `xhigh` are all observed). Antigravity reports nothing that corresponds to
 * `default` or `max`, so neither is offered. That is an open decision for the
 * design doc, not a guess made here.
 */
/**
 * A session with no `model` config option cannot switch models, so a launch can
 * only ever run the model the session reports as current. Listing any other
 * `availableModels` id would offer a model every launch rejects.
 */
const modelsWithoutChoice = (session: NewSessionResult): ProviderModelsReport => {
  const current = session.models?.currentModelId;
  const reported = session.models?.availableModels ?? [];
  const runnable = reported.filter((model) => model.modelId === current);
  const skipped = reported
    .filter((model) => model.modelId !== current)
    .map((model) => ({
      what: `Antigravity model ${model.modelId}`,
      why: 'agy offers no model choice for a session, so only its current model can launch',
    }));
  return {
    models: runnable.map((model) => ({ id: model.modelId, label: model.name, efforts: [] })),
    skipped,
  };
};

export const antigravityModelsFromSession = (session: NewSessionResult): ProviderModelsReport => {
  const available = new Set((session.models?.availableModels ?? []).map((model) => model.modelId));
  const families = session.configOptions?.find((option) => option.id === 'model')?.options;
  const levels = (
    session.configOptions?.find((option) => option.id === 'thought_level')?.options ?? []
  ).map((level) => level.value);

  if (!families) {
    return modelsWithoutChoice(session);
  }

  const models: CapabilityCatalogModel[] = [];
  const skipped: SkippedProviderEntry[] = [];
  for (const family of families) {
    const efforts = levels.filter((level) => available.has(`${family.value}-${level}`));
    if (efforts.length === 0 && !available.has(family.value)) {
      skipped.push({
        what: `Antigravity model ${family.value}`,
        why: 'agy lists it as a model but reports no launchable id for it',
      });
      continue;
    }
    models.push({ id: family.value, label: family.name, efforts });
  }
  return { models, skipped };
};

export class AntigravityModelReader implements ProviderModelReader {
  public readonly provider = 'antigravity';
  public readonly displayName = 'Antigravity';

  public constructor(private readonly executable = 'agy') {}

  public async readModels(): Promise<ProviderModelsReport> {
    const cwd = await mkdtemp(join(tmpdir(), 'heyhey-model-catalog-'));
    const client = new AntigravityAcpClient(
      cwd,
      NOOP_LOGGER,
      () => undefined,
      () => undefined,
      [],
      this.executable,
    );
    try {
      await client.initialize();
      return antigravityModelsFromSession(await client.createSession({ cwd, mcpServers: [] }));
    } catch (error) {
      throw this.explain(error);
    } finally {
      client.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  }

  private explain(error: unknown): Error {
    if (isMissingExecutable(error) || isMissingExecutable((error as Error).cause)) {
      return new ProviderNotInstalledError(this.displayName, 'agy');
    }
    if (error instanceof AntigravityNotReadyError) {
      return error;
    }
    const text = error instanceof Error ? error.message : String(error);
    const cause = classifyAntigravityFailure(text);
    if (cause) {
      return new AntigravityNotReadyError(cause, text);
    }
    return error instanceof AcpRequestError
      ? new Error(`Antigravity ${error.method} failed (${String(error.code)}): ${error.message}`)
      : error instanceof Error
        ? error
        : new Error(text);
  }
}
