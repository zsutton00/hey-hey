import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { APIError } from '@typesafe-ai/sdk';
import { TypeSafeJevService } from '../typesafe-jev.service';

const systemOne = jest.fn();
const clientConstructor = jest.fn();

jest.mock('@typesafe-ai/sdk', () => ({
  APIError: jest.requireActual('@typesafe-ai/sdk').APIError,
  choice: jest.fn((instructions, criteria) => ({
    type: 'choice',
    instructions,
    criteria,
  })),
  TypeSafeClient: jest.fn().mockImplementation((config) => {
    clientConstructor(config);
    return { systemOne };
  }),
}));

describe('TypeSafeJevService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createService = async (apiKey?: string) => {
    const module = await Test.createTestingModule({
      providers: [
        TypeSafeJevService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(apiKey),
          },
        },
      ],
    }).compile();

    return module.get(TypeSafeJevService);
  };

  it('returns a typed configuration failure without constructing a client when the key is absent', async () => {
    const service = await createService();

    await expect(
      service.evaluateChoice({
        state: { query: 'find the billing task' },
        question: 'Which task matches the query?',
        criteria: { billing: 'Billing task', other: 'Another task' },
      }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        code: 'MISSING_API_KEY',
        message: 'TypeSafe evaluation is not configured on this server.',
      },
    });
    expect(clientConstructor).not.toHaveBeenCalled();
  });

  it('constructs the server-side SDK client and maps typed answers and usage', async () => {
    systemOne.mockResolvedValue({
      model: 'jev-test',
      answers: {
        answer: {
          type: 'choice',
          choice: 'billing',
          confidence: 0.92,
          probabilities: { billing: 0.92, other: 0.08 },
        },
      },
      usage: { input_tokens: 13, output_tokens: 5 },
    });
    const service = await createService('ts_test_key');

    await expect(
      service.evaluateChoice({
        state: { query: 'find the billing task' },
        question: 'Which task matches the query?',
        criteria: { billing: 'Billing task', other: 'Another task' },
      }),
    ).resolves.toEqual({
      ok: true,
      answer: {
        choice: 'billing',
        confidence: 0.92,
        probabilities: { billing: 0.92, other: 0.08 },
      },
      model: 'jev-test',
      usage: { inputTokens: 13, outputTokens: 5 },
    });

    expect(clientConstructor).toHaveBeenCalledWith({
      apiKey: 'ts_test_key',
      dangerouslyAllowBrowser: false,
      logLevel: 'off',
    });
    expect(systemOne).toHaveBeenCalledWith({
      state: { query: 'find the billing task' },
      questions: {
        answer: {
          type: 'choice',
          instructions: 'Which task matches the query?',
          criteria: { billing: 'Billing task', other: 'Another task' },
        },
      },
    });
  });

  it('returns a safe typed provider failure without exposing provider details', async () => {
    systemOne.mockRejectedValue(
      new APIError(
        401,
        { error: 'secret response content must not escape' },
        new Headers(),
      ),
    );
    const service = await createService('ts_test_key');

    await expect(
      service.evaluateChoice({
        state: 'smoke test',
        question: 'Is this a smoke test?',
        criteria: { yes: 'Yes', no: 'No' },
      }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        code: 'PROVIDER_ERROR',
        message: 'TypeSafe evaluation failed.',
        status: 401,
      },
    });
  });
});
