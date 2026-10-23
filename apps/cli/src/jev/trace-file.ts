import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { gatherTraceSchema, type GatherTrace } from './trace';

const traceFileSchema = z.object({ runId: z.string(), rounds: z.array(gatherTraceSchema) });

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * Add one stored round to the run's own trace file, `<dir>/<runId>.json`, which holds every
 * round of every turn in the order they finished. Returns the file path.
 */
export const appendGatherTraceFile = async (dir: string, trace: GatherTrace): Promise<string> => {
  const file = path.join(dir, `${trace.runId}.json`);
  let rounds: GatherTrace[] = [];
  try {
    rounds = traceFileSchema.parse(JSON.parse(await readFile(file, 'utf8'))).rounds;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ runId: trace.runId, rounds: [...rounds, trace] }, null, 2)}\n`,
    'utf8',
  );
  return file;
};
