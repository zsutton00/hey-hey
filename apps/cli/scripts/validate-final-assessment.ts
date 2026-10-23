import fs from 'node:fs/promises';
import process from 'node:process';
import { parseFinalAssessmentResponse } from '@hey-hey/ui-common/agents';

const usage = (): void => {
  console.error('Usage: pnpm tsx scripts/validate-final-assessment.ts [path-to-json]');
  console.error('If no file path is provided, JSON is read from stdin.');
};

const readStdin = async (): Promise<string> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  }
  return chunks.join('');
};

const readInputText = async (): Promise<string> => {
  const [inputPath] = process.argv.slice(2);
  if (inputPath) {
    return fs.readFile(inputPath, 'utf8');
  }

  if (process.stdin.isTTY) {
    usage();
    process.exitCode = 1;
    return '';
  }

  return readStdin();
};

const main = async (): Promise<void> => {
  const text = await readInputText();
  if (!text.trim()) {
    if (process.exitCode === 1) {
      return;
    }
    console.error('Input JSON is empty.');
    process.exitCode = 1;
    return;
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Invalid JSON: ${message}`);
    process.exitCode = 1;
    return;
  }

  const result = parseFinalAssessmentResponse(parsedJson);
  if (!result.ok) {
    console.error('Schema validation failed.');
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  console.log('Schema validation passed.');
  console.log(
    JSON.stringify(
      {
        responseType: result.value.responseType,
        verdict: result.value.taskAssessment.verdict,
        validationRecommendationCount: result.value.validationRecommendations.length,
      },
      null,
      2,
    ),
  );
};

void main();
