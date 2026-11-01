import type { EvalCost } from '../shared/api/generated/api';
import type { ServerLogger } from '../server/logger';
import {
  SessionCostAdapter,
  type CcusageSessionJsonReader,
} from '../server/services/session-cost-adapter';

const UNAVAILABLE: EvalCost = { state: 'unavailable' };
const isCcusageProvider = (provider: string): provider is 'claude' | 'codex' =>
  provider === 'claude' || provider === 'codex';

/**
 * Reads what a settled provider session cost from ccusage. Providers ccusage
 * does not cover, a missing session id and a read that throws all become
 * `unavailable` for this one session; nothing here ever reports zero.
 */
export class SessionCostReader {
  private readonly adapter: SessionCostAdapter;

  /**
   * A settlement read must see the session as it finished, so reports are never
   * cached: another attempt's earlier read of the same provider must not be reused.
   */
  public constructor(
    private readonly logger: ServerLogger,
    ccusage?: CcusageSessionJsonReader,
  ) {
    this.adapter = new SessionCostAdapter(ccusage, false);
  }

  public async read(provider: string, sessionId: string | null): Promise<EvalCost> {
    if (!isCcusageProvider(provider) || !sessionId || sessionId.startsWith('pending_')) {
      return UNAVAILABLE;
    }

    try {
      const cost = await this.adapter.read({
        providerId: provider,
        providerSessionId: sessionId,
      });
      if (cost.state !== 'available') {
        this.logger.debug('provider_usage.session_cost.unavailable', {
          provider,
          sessionId,
          reason: cost.reason,
        });
        return UNAVAILABLE;
      }

      return { state: 'available', amount: cost.amountUsd, currency: 'USD' };
    } catch (error) {
      this.logger.warn('provider_usage.session_cost.read_failed', { provider, sessionId, error });
      return UNAVAILABLE;
    }
  }
}
