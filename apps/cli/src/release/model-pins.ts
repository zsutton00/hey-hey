import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import type { ReleaseManifest } from './release-manifest';

const pinSchema = z.object({ file: z.string(), path: z.string(), sha256: z.string() });
const pinsSchema = z.object({
  repository: z.string(),
  revision: z.string(),
  files: z.object({ modelQuantized: pinSchema, tokenizer: pinSchema }),
});

/**
 * The manifest `models` section described by apps/graph-search/model-pins.json, the one set of
 * pinned values shared with that service's fetch-model.sh.
 */
export function modelsFromPins(file: string): ReleaseManifest['models'] {
  const pins = pinsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const entry = (pin: z.infer<typeof pinSchema>) => ({
    file: pin.file,
    url: `https://huggingface.co/${pins.repository}/resolve/${pins.revision}/${pin.path}`,
    sha256: pin.sha256,
  });

  return {
    modelQuantized: entry(pins.files.modelQuantized) as ReleaseManifest['models']['modelQuantized'],
    tokenizer: entry(pins.files.tokenizer) as ReleaseManifest['models']['tokenizer'],
  };
}
