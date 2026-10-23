import { z } from 'zod';
import { FeatureTag } from 'src/generated/model/featureTag';

export const FEATURE_TAGS = [
  'product',
  'frontend',
  'backend',
  'infra',
  'design',
  'AI',
] as const satisfies ReadonlyArray<FeatureTag>;

type _AllTagsCovered =
  Exclude<FeatureTag, (typeof FEATURE_TAGS)[number]> extends never
    ? true
    : false;
const _allTagsCovered: _AllTagsCovered = true;
void _allTagsCovered;

export const featureTagSchema = z.enum(FEATURE_TAGS);

export type { FeatureTag };
