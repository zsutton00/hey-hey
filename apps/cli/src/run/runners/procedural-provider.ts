import type { Run } from '../run';
import type { SessionRunnerFacade } from '../../server/runtime/providers/select';

/** Structured generation on the Run's admitted provider, with no model-side tools. */
export class ProceduralProvider {
  constructor(
    private readonly run: Run,
    private readonly providers: SessionRunnerFacade,
  ) {}

  async generate(prompt: string, signal: AbortSignal): Promise<string> {
    const { session } = this.run;
    const model = session.model;
    if (!model) {
      throw new Error('Onboarding requires a complete saved runtime selection');
    }
    return this.run.captureProviderOutput(async () => {
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
  }
}
