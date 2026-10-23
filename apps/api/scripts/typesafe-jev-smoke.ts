import { ConfigService } from '@nestjs/config';
import { TypeSafeJevService } from '../src/services/typesafe-jev/typesafe-jev.service';

async function main(): Promise<void> {
  const service = new TypeSafeJevService(new ConfigService());
  const result = await service.evaluateChoice({
    state: {
      smoke: 'Use the positive result for this authentication smoke check.',
    },
    question: 'Which result does this smoke check request?',
    criteria: {
      positive: 'The positive result.',
      negative: 'The negative result.',
    },
  });

  if (!result.ok) {
    console.error(result.failure.message);
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify({
      ok: true,
      model: result.model,
      answer: result.answer,
      usage: result.usage,
    }),
  );
}

void main();
