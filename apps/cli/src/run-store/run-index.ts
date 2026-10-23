import fs from 'node:fs/promises';
import type { AgenticSession } from '../session/types';
import type { RunIndex } from './types';

const CURRENT_VERSION = 1 as const;

const createEmptyIndex = (): RunIndex => ({
  version: CURRENT_VERSION,
  byAgentSessionId: {},
  byProviderSessionId: {},
  byCanonicalRunId: {},
  byPromptType: {},
  byConversationId: {},
});

const isValidIndex = (value: unknown): value is RunIndex => {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as Record<string, unknown>)['version'] !== CURRENT_VERSION ||
    typeof (value as Record<string, unknown>)['byAgentSessionId'] !== 'object' ||
    typeof (value as Record<string, unknown>)['byProviderSessionId'] !== 'object' ||
    typeof (value as Record<string, unknown>)['byCanonicalRunId'] !== 'object'
  ) {
    return false;
  }
  // Backfill byPromptType if missing from older index files.
  if (typeof (value as Record<string, unknown>)['byPromptType'] !== 'object') {
    (value as Record<string, unknown>)['byPromptType'] = {};
  }
  // Backfill byConversationId if missing from older index files. Empty here is
  // not fatal: RunStore.initialize() rebuilds from runs on disk when the
  // map is empty but runs exist, so existing sessions become resolvable on the
  // next CLI start.
  if (typeof (value as Record<string, unknown>)['byConversationId'] !== 'object') {
    (value as Record<string, unknown>)['byConversationId'] = {};
  }
  return true;
};

const migrateIndex = (value: unknown): RunIndex | null => {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as Record<string, unknown>)['version'] !== CURRENT_VERSION
  ) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (
    typeof rec['byCodingSessionId'] === 'object' &&
    typeof rec['byProviderSessionId'] === 'object' &&
    typeof rec['byCanonicalRunId'] === 'object'
  ) {
    return {
      version: CURRENT_VERSION,
      byAgentSessionId: rec['byCodingSessionId'] as Record<string, string>,
      byProviderSessionId: rec['byProviderSessionId'] as Record<string, string>,
      byCanonicalRunId: rec['byCanonicalRunId'] as Record<string, string>,
      byPromptType: {},
      byConversationId: {},
    };
  }
  return null;
};

const readAgentSessionId = (run: AgenticSession): string | null => {
  const agentSessionId = run.contextMetadata?.agentSessionId;
  return typeof agentSessionId === 'string' && agentSessionId.length > 0 ? agentSessionId : null;
};

const canonicalId = (run: AgenticSession): string | null =>
  run.provider_conversation_id ?? run.provider_session_id ?? null;

export class RunIndexStore {
  public async load(indexPath: string): Promise<RunIndex> {
    try {
      const text = await fs.readFile(indexPath, 'utf8');
      if (!text.trim()) return createEmptyIndex();
      const parsed: unknown = JSON.parse(text);
      if (isValidIndex(parsed)) return parsed;
      const migrated = migrateIndex(parsed);
      if (migrated) return migrated;
      return createEmptyIndex();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return createEmptyIndex();
      }
      throw error;
    }
  }

  public async save(indexPath: string, index: RunIndex): Promise<void> {
    const tmp = `${indexPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
    await fs.rename(tmp, indexPath);
  }

  public addRun(index: RunIndex, run: AgenticSession): void {
    const agentSessionId = readAgentSessionId(run);
    if (agentSessionId) {
      index.byAgentSessionId[agentSessionId] = run.agentic_session_id;
    }

    if (run.provider_session_id) {
      index.byProviderSessionId[run.provider_session_id] = run.agentic_session_id;
    }

    const canonical = canonicalId(run);
    if (canonical) {
      index.byCanonicalRunId[canonical] = run.agentic_session_id;
    }

    if (run.promptType) {
      const list = index.byPromptType[run.promptType] ?? [];
      if (!list.includes(run.agentic_session_id)) {
        list.push(run.agentic_session_id);
      }
      index.byPromptType[run.promptType] = list;
    }

    if (run.conversationId) {
      index.byConversationId[run.conversationId] = run.agentic_session_id;
    }
  }

  public removeRun(index: RunIndex, run: AgenticSession): void {
    const agentSessionId = readAgentSessionId(run);
    if (agentSessionId && index.byAgentSessionId[agentSessionId] === run.agentic_session_id) {
      delete index.byAgentSessionId[agentSessionId];
    }

    if (
      run.provider_session_id &&
      index.byProviderSessionId[run.provider_session_id] === run.agentic_session_id
    ) {
      delete index.byProviderSessionId[run.provider_session_id];
    }

    const canonical = canonicalId(run);
    if (canonical && index.byCanonicalRunId[canonical] === run.agentic_session_id) {
      delete index.byCanonicalRunId[canonical];
    }

    if (run.promptType && index.byPromptType[run.promptType]) {
      const list = index.byPromptType[run.promptType]!.filter(
        (id) => id !== run.agentic_session_id,
      );
      if (list.length === 0) {
        delete index.byPromptType[run.promptType];
      } else {
        index.byPromptType[run.promptType] = list;
      }
    }

    if (
      run.conversationId &&
      index.byConversationId[run.conversationId] === run.agentic_session_id
    ) {
      delete index.byConversationId[run.conversationId];
    }
  }

  public updateProviderIdentity(
    index: RunIndex,
    previous: AgenticSession,
    updated: AgenticSession,
  ): void {
    if (previous.provider_session_id !== updated.provider_session_id) {
      if (
        previous.provider_session_id &&
        index.byProviderSessionId[previous.provider_session_id] === previous.agentic_session_id
      ) {
        delete index.byProviderSessionId[previous.provider_session_id];
      }
      if (updated.provider_session_id) {
        index.byProviderSessionId[updated.provider_session_id] = updated.agentic_session_id;
      }
    }

    const prevCanonical = canonicalId(previous);
    const newCanonical = canonicalId(updated);
    if (prevCanonical !== newCanonical) {
      if (prevCanonical && index.byCanonicalRunId[prevCanonical] === previous.agentic_session_id) {
        delete index.byCanonicalRunId[prevCanonical];
      }
      if (newCanonical) {
        index.byCanonicalRunId[newCanonical] = updated.agentic_session_id;
      }
    }
  }

  public lookupByAgentSessionId(index: RunIndex, agentSessionId: string): string | null {
    return index.byAgentSessionId[agentSessionId] ?? null;
  }

  public lookupByProviderSessionId(index: RunIndex, providerSessionId: string): string | null {
    return index.byProviderSessionId[providerSessionId] ?? null;
  }

  public lookupByCanonicalRunId(index: RunIndex, canonicalRunId: string): string | null {
    return index.byCanonicalRunId[canonicalRunId] ?? null;
  }

  public lookupByConversationId(index: RunIndex, conversationId: string): string | null {
    return index.byConversationId[conversationId] ?? null;
  }

  public rebuildFromRuns(runs: AgenticSession[]): RunIndex {
    const index = createEmptyIndex();
    const sorted = [...runs].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    for (const run of sorted) {
      this.addRun(index, run);
    }
    return index;
  }
}
