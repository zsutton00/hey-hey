import { APIError, APITimeoutError, TypeSafeClient } from '@typesafe-ai/sdk';
import type { EntryType, Question } from '@typesafe-ai/sdk';
import { z } from 'zod';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';

export const DEFAULT_JEV_MODEL = 'jev-latest';
export const JEV_TIMEOUT_MS = 10_000;

export type JevQuestion = Question;
export interface JevInput {
  model: string;
  state: EntryType;
  questions: Record<string, JevQuestion>;
}

const probabilitySchema = z.number().finite().min(0).max(1);
export const answerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    probabilities: z.record(probabilitySchema),
    confidence: probabilitySchema,
  }),
  z.object({
    type: z.literal('score'),
    score: z.number().finite().nonnegative(),
    probabilities: z.record(probabilitySchema),
    confidence: probabilitySchema,
  }),
  z.object({ type: z.literal('noul'), noul: probabilitySchema }),
]);

const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(answerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

const modelListSchema = z.array(z.object({ name: z.string().min(1) }));

export type JevAnswer = z.infer<typeof answerSchema>;
export type JevFailureCode = 'PROVIDER_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE';
export interface JevFailure {
  code: JevFailureCode;
  message: string;
  providerStatus?: number;
  /** What the provider said was wrong (its error body), present for HTTP errors. */
  providerDetail?: string;
  /** The thrown error's class, message and cause chain, present for every thrown failure. */
  errorDetail?: string;
}

/**
 * Each error's class and `code`, following `cause` (where network errors keep their reason), then
 * the thrower's stack frames. Messages are left out: they can carry the key or request content.
 */
export const describeError = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    if (!(current instanceof Error)) {
      parts.push(typeof current);
      break;
    }
    const code = (current as { code?: unknown }).code;
    parts.push(typeof code === 'string' ? `${current.name} [${code}]` : current.name);
    current = current.cause;
  }
  const frames =
    error instanceof Error
      ? (error.stack ?? '')
          .split('\n')
          .filter((line) => line.trimStart().startsWith('at '))
          .slice(0, 5)
          .map((line) => line.trim())
      : [];
  return [parts.join(' <- caused by '), ...frames].join('\n');
};
export type JevModelsResult = { ok: true; models: string[] } | { ok: false; failure: JevFailure };
export type JevResult =
  | {
      ok: true;
      model: string;
      answers: Record<string, JevAnswer>;
      usage: { inputTokens: number; outputTokens: number };
      durationMs: number;
    }
  | { ok: false; failure: JevFailure };

const hasSameKeys = (left: object, right: object): boolean => {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key))
  );
};

/** Check the external answer's identity and complete distributions against its request. */
const answersMatchQuestions = (
  answers: Record<string, JevAnswer>,
  questions: Record<string, JevQuestion>,
): boolean =>
  hasSameKeys(answers, questions) &&
  Object.entries(questions).every(([name, question]) => {
    const answer = answers[name];
    if (answer?.type !== question.type) return false;
    if (question.type === 'choice' && answer.type === 'choice') {
      return (
        Object.hasOwn(question.criteria, answer.choice) &&
        hasSameKeys(question.criteria, answer.probabilities)
      );
    }
    if (question.type === 'score' && answer.type === 'score') {
      return (
        answer.score <= question.criteria.length - 1 &&
        hasSameKeys(question.criteria, answer.probabilities)
      );
    }
    return true;
  });

/** Local-only provider access. Never log SDK objects or request content. */
export class JevClient {
  readonly #sdk: TypeSafeClient;

  public constructor(
    sdk: TypeSafeClient,
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {
    this.#sdk = sdk;
  }

  /** The model ids available to the account. */
  public async listModels(): Promise<JevModelsResult> {
    try {
      const response = modelListSchema.safeParse(await this.#sdk.models.list());
      if (!response.success) {
        this.logger.debug('jev.models.invalid_response');
        return {
          ok: false,
          failure: { code: 'INVALID_RESPONSE', message: 'Jev returned an invalid model list.' },
        };
      }
      this.logger.debug('jev.models.completed', { modelCount: response.data.length });
      return { ok: true, models: response.data.map((card) => card.name) };
    } catch (error) {
      const code = error instanceof APITimeoutError ? 'TIMEOUT' : 'PROVIDER_ERROR';
      const providerStatus = error instanceof APIError ? error.status : undefined;
      const errorDetail = describeError(error);
      this.logger.error('jev.models.failed', {
        code,
        ...(providerStatus !== undefined ? { providerStatus } : {}),
        errorDetail,
      });
      return {
        ok: false,
        failure: {
          code,
          message: code === 'TIMEOUT' ? 'Jev model lookup timed out.' : 'Jev model lookup failed.',
          ...(providerStatus !== undefined ? { providerStatus } : {}),
          errorDetail,
        },
      };
    }
  }

  /** A cancelled `signal` rejects instead of returning a failure: nothing was judged, nothing failed. */
  public async evaluate(input: JevInput, options?: { signal?: AbortSignal }): Promise<JevResult> {
    const startedAt = performance.now();
    this.logger.debug('jev.evaluate.started', {
      model: input.model,
      questionCount: Object.keys(input.questions).length,
      requestChars: JSON.stringify(input.state).length + JSON.stringify(input.questions).length,
    });
    try {
      const response = responseSchema.safeParse(await this.#sdk.systemOne(input, options));
      if (!response.success || !answersMatchQuestions(response.data.answers, input.questions)) {
        this.logger.error('jev.evaluate.invalid_response', {
          model: input.model,
          questionCount: Object.keys(input.questions).length,
          ...(response.success
            ? { reason: 'answers_do_not_match_questions' }
            : {
                reason: 'schema',
                issues: response.error.issues
                  .slice(0, 5)
                  .map((issue) => `${issue.path.join('.')}: ${issue.message}`),
              }),
          durationMs: performance.now() - startedAt,
        });
        return {
          ok: false,
          failure: {
            code: 'INVALID_RESPONSE',
            message: 'Jev returned an invalid evaluation result.',
          },
        } satisfies JevResult;
      }
      const { model, answers, usage } = response.data;
      const durationMs = performance.now() - startedAt;
      this.logger.debug('jev.evaluate.completed', {
        durationMs,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      });
      return {
        ok: true,
        model,
        answers,
        usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
        durationMs,
      } satisfies JevResult;
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      const code = error instanceof APITimeoutError ? 'TIMEOUT' : 'PROVIDER_ERROR';
      const providerStatus = error instanceof APIError ? error.status : undefined;
      const providerDetail = error instanceof APIError ? error.message : undefined;
      const errorDetail = describeError(error);
      this.logger.error('jev.evaluate.failed', {
        code,
        ...(providerStatus !== undefined ? { providerStatus } : {}),
        ...(providerDetail !== undefined ? { providerDetail } : {}),
        errorDetail,
        model: input.model,
        questionCount: Object.keys(input.questions).length,
        requestChars: JSON.stringify(input.state).length + JSON.stringify(input.questions).length,
        durationMs: performance.now() - startedAt,
      });
      return {
        ok: false,
        failure: {
          code,
          message: code === 'TIMEOUT' ? 'Jev evaluation timed out.' : 'Jev evaluation failed.',
          ...(providerStatus !== undefined ? { providerStatus } : {}),
          ...(providerDetail !== undefined ? { providerDetail } : {}),
          errorDetail,
        },
      } satisfies JevResult;
    }
  }
}

/** The user's Jev key from their environment; undefined when none is defined. */
export function readJevApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return env['TYPESAFE_API_KEY']?.trim() || undefined;
}

/** Read the user's opt-in once at startup; constructing a client makes no requests. */
export function createJevClient(
  env: NodeJS.ProcessEnv,
  logger: ServerLogger = NOOP_LOGGER,
): JevClient | undefined {
  const apiKey = readJevApiKey(env);
  if (!apiKey) {
    logger.debug('jev.client.disabled');
    return undefined;
  }
  const sdk = new TypeSafeClient({
    apiKey,
    baseURL: 'https://api.typesafe.ai',
    defaultModel: DEFAULT_JEV_MODEL,
    logLevel: 'off',
    timeout: JEV_TIMEOUT_MS,
    retry: { maxRetries: 0 },
  });
  logger.debug('jev.client.enabled');
  return new JevClient(sdk, logger);
}
