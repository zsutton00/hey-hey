import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import type {
  JevChoiceEvaluationRequestDto,
  JevChoiceEvaluationResponseDto,
} from '../../generated';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { TypeSafeJevController } from '../typesafe-jev.controller';
import { TypeSafeJevService } from '../../services/typesafe-jev/typesafe-jev.service';

describe('TypeSafeJevController HTTP contract', () => {
  const path = '/api/v1/jev/evaluate-choice';
  const input: JevChoiceEvaluationRequestDto = {
    state: { query: 'find the billing task' },
    question: 'Which task matches the query?',
    criteria: {
      billing: 'Billing task',
      other: 'Another task',
    },
  };
  let app: INestApplication<App>;
  let evaluateChoice: jest.Mock;

  beforeAll(async () => {
    evaluateChoice = jest.fn();
    const module = await Test.createTestingModule({
      controllers: [TypeSafeJevController],
      providers: [
        {
          provide: TypeSafeJevService,
          useValue: { evaluateChoice },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterEach(() => {
    evaluateChoice.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the typed successful evaluation through the global response envelope', async () => {
    const result: JevChoiceEvaluationResponseDto = {
      ok: true,
      answer: {
        choice: 'billing',
        confidence: 0.92,
        probabilities: { billing: 0.92, other: 0.08 },
      },
      model: 'jev-test',
      usage: { inputTokens: 13, outputTokens: 5 },
    };
    evaluateChoice.mockResolvedValue(result);

    await request(app.getHttpAdapter().getInstance())
      .post(path)
      .send(input)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ success: true, data: result });
      });

    expect(evaluateChoice).toHaveBeenCalledWith(input);
  });

  it('returns the bounded missing-key failure without exposing configuration details', async () => {
    const result: JevChoiceEvaluationResponseDto = {
      ok: false,
      failure: {
        code: 'MISSING_API_KEY',
        message: 'TypeSafe evaluation is not configured on this server.',
      },
    };
    evaluateChoice.mockResolvedValue(result);

    await request(app.getHttpAdapter().getInstance())
      .post(path)
      .send(input)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual(result);
        expect(JSON.stringify(body)).not.toContain('TYPESAFE_API_KEY');
      });
  });

  it('returns a bounded provider failure without leaking raw provider details', async () => {
    const result: JevChoiceEvaluationResponseDto = {
      ok: false,
      failure: {
        code: 'PROVIDER_ERROR',
        message: 'TypeSafe evaluation failed.',
        status: 401,
      },
    };
    evaluateChoice.mockResolvedValue(result);

    await request(app.getHttpAdapter().getInstance())
      .post(path)
      .send(input)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual(result);
        expect(JSON.stringify(body)).not.toContain('secret response content');
      });
  });
});
