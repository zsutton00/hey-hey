import type { Run } from '../run';
import type { SessionRunnerFacade } from '../../server/runtime/providers/select';

/** Structured generation on the Run's admitted provider, with no model-side tools. */
export class ProceduralProvider {
  constructor(
    private readonly run: Run,
    private readonly providers: SessionRunnerFacade,
  ) {}

  /**
   * The procedure is waiting on something other than the provider, so the Turn's `starting`
   * label no longer applies. The Run's terminal cleanup still ends the Turn.
   */
  settleWhileWaiting(): void {
    this.run.observeProviderPhase('idle');
  }

  async generate(prompt: string, signal: AbortSignal): Promise<string> {
    const { session } = this.run;
    const model = session.model;
    if (!model) {
      throw new Error('Onboarding requires a complete saved runtime selection');
    }
    // Captured output never reaches the status handler, so the call itself is the working interval.
    this.run.observeProviderPhase('thinking');
    try {
      return await this.run.captureProviderOutput(async () => {
        const result = await this.providers.runPrompt(this.run, {
          session,
          prompt,
          model,
          ...(session.reasoningEffort ? { reasoningEffort: session.reasoningEffort } : {}),
          signal,
          mcpToolUseCase: 'local_onboarding',
          replaceProviderSystemPrompt: true,
          readOnlyFilesystem: true,
          builtinTools: [],
        });
        if (result.errorCount > 0) {
          throw new Error('The onboarding provider request failed');
        }
      });
    } finally {
      this.run.observeProviderPhase('idle');
    }
  }
}
