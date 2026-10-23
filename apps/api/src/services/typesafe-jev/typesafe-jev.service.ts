import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  APIError,
  choice,
  TypeSafeClient,
  type ChoiceCriteria,
  type EntryType,
} from '@typesafe-ai/sdk';

export type JevChoiceEvaluationRequest<Criteria extends ChoiceCriteria> = {
  state: EntryType;
  question: EntryType;
  criteria: Criteria;
};

export type JevChoiceEvaluationAnswer<Criteria extends ChoiceCriteria> = {
  choice: keyof Criteria & string;
  confidence: number;
  probabilities: {
    readonly [label in keyof Criteria]: number;
  };
};

export type JevChoiceEvaluationSuccess<Criteria extends ChoiceCriteria> = {
  ok: true;
  answer: JevChoiceEvaluationAnswer<Criteria>;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type JevChoiceEvaluationFailure = {
  ok: false;
  failure: {
    code: 'MISSING_API_KEY' | 'PROVIDER_ERROR';
    message: string;
    status?: number;
  };
};

export type JevChoiceEvaluationResult<Criteria extends ChoiceCriteria> =
  | JevChoiceEvaluationSuccess<Criteria>
  | JevChoiceEvaluationFailure;

@Injectable()
export class TypeSafeJevService {
  private readonly apiKey: string | undefined;
  private client: TypeSafeClient | undefined;

  constructor(private readonly configService: ConfigService) {
    const configuredApiKey = this.configService.get<string>('TYPESAFE_API_KEY');
    this.apiKey = configuredApiKey?.trim() || undefined;
  }

  async evaluateChoice<const Criteria extends ChoiceCriteria>(
    input: JevChoiceEvaluationRequest<Criteria>,
  ): Promise<JevChoiceEvaluationResult<Criteria>> {
    let client: TypeSafeClient | undefined;
    try {
      client = this.getClient();
    } catch {
      return this.providerFailure();
    }

    if (!client) {
      return {
        ok: false,
        failure: {
          code: 'MISSING_API_KEY',
          message: 'TypeSafe evaluation is not configured on this server.',
        },
      };
    }

    try {
      const response = await client.systemOne({
        state: input.state,
        questions: {
          answer: choice(input.question, input.criteria),
        },
      });
      const answer = response.answers.answer;

      return {
        ok: true,
        answer: {
          choice: answer.choice,
          confidence: answer.confidence,
          probabilities: answer.probabilities,
        },
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  private getClient(): TypeSafeClient | undefined {
    if (!this.apiKey) {
      return undefined;
    }

    return (this.client ??= new TypeSafeClient({
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: false,
      logLevel: 'off',
    }));
  }

  private providerFailure(error?: unknown): JevChoiceEvaluationFailure {
    return {
      ok: false,
      failure: {
        code: 'PROVIDER_ERROR',
        message: 'TypeSafe evaluation failed.',
        ...(error instanceof APIError ? { status: error.status } : {}),
      },
    };
  }
}
