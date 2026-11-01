import { getCacheInclusiveInputTokens } from './cache-inclusive-input';
import { z } from 'zod';
import type { SubAgentUsage } from '../run/subagent';
import {
  createCcusageSessionJsonReader,
  type CcusageSessionJsonReader,
} from '../server/services/session-cost-adapter';

const count = z.number().int().nonnegative().optional();
const sessionIdentity = z.object({ sessionId: z.string() }).passthrough();
const sessionUsage = z.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheCreationTokens: count,
});
const sessionReport = z.object({ sessions: z.array(z.unknown()) });

/** Reads retained native session records afresh; never consumes Run telemetry. */
export class SessionTokenUsageReader {
  public constructor(
    private readonly readReport: CcusageSessionJsonReader = createCcusageSessionJsonReader(
      undefined,
      true,
    ),
  ) {}

  public async read(provider: string, sessionId: string | null): Promise<SubAgentUsage> {
    if (
      (provider !== 'claude' && provider !== 'codex') ||
      !sessionId ||
      sessionId.startsWith('pending_')
    ) {
      return {};
    }
    const report = sessionReport.parse(
      JSON.parse(
        await this.readReport(provider, undefined, {
          sessionIds: [sessionId],
        }),
      ),
    );
    const identities = report.sessions.flatMap((record) => {
      const parsed = sessionIdentity.safeParse(record);
      return parsed.success ? [parsed.data] : [];
    });
    const matches = identities.filter(
      (session) =>
        session.sessionId === sessionId ||
        (provider === 'codex' && session.sessionId.endsWith(`-${sessionId}`)),
    );
    if (matches.length !== 1) {
      throw new Error('Native provider session usage is unavailable or ambiguous.');
    }
    const session = sessionUsage.parse(matches[0]);
    // ccusage's unified session report already separates fresh input from cache
    // reads for both providers. Its totalTokens includes cache and is never used.
    const usage: SubAgentUsage = {
      ...(session.inputTokens !== undefined ? { inputTokens: session.inputTokens } : {}),
      ...(session.outputTokens !== undefined ? { outputTokens: session.outputTokens } : {}),
      ...(session.cacheReadTokens !== undefined
        ? { cacheReadInputTokens: session.cacheReadTokens }
        : {}),
      ...(provider === 'claude' && session.cacheCreationTokens !== undefined
        ? { cacheCreationInputTokens: session.cacheCreationTokens }
        : {}),
    };
    const cacheInclusiveInputTokens = getCacheInclusiveInputTokens(provider, usage);
    return {
      ...usage,
      ...(cacheInclusiveInputTokens !== undefined ? { cacheInclusiveInputTokens } : {}),
    };
  }
}
