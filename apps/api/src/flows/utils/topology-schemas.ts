import { z } from 'zod';
import {
  entityClassificationSchema,
  influenceSchema,
  priorityHintSchema,
} from './shared-schemas';
import { SummaryCategory } from '@prisma/client';

// Explicit topology categories to keep models consistent
export const topologyCategories: SummaryCategory[] = [
  'technology',
  'product',
  'process',
  'people',
] as const;
export const TopologyCategoryEnum = z.enum(
  topologyCategories as [string, ...string[]],
);
const MAX_CONSOLIDATION_SUBFACET_NAME_WORDS = 3;
const consolidationSubfacetNameSchema = z.string().trim().min(1);
const constrainedConsolidationSubfacetNameSchema =
  consolidationSubfacetNameSchema
    .refine((name) => !name.includes('&'), {
      message: 'Subfacet name must not include "&"',
    })
    .refine(
      (name) =>
        name.split(/\s+/).filter(Boolean).length <=
        MAX_CONSOLIDATION_SUBFACET_NAME_WORDS,
      {
        message: `Subfacet name must be ${MAX_CONSOLIDATION_SUBFACET_NAME_WORDS} words or fewer`,
      },
    );

// Normalized shape for entity-level topology summaries (generation-time or post-hoc)
export const entityTopologySchema = entityClassificationSchema.extend({
  title: z.string().describe('Entity title or identifier'),
  mode: z
    .enum(['generation', 'post_hoc'])
    .describe(
      'Whether this summary was produced during generation or after edits',
    ),
  influences: z.array(influenceSchema).nullable().optional().default([]),
  sourceEntityId: z
    .string()
    .nullable()
    .optional()
    .describe('Optional UUID of the edited entity when mode=post_hoc'),
});

export type EntityTopology = z.infer<typeof entityTopologySchema>;

// Helper projection for entity summaries when rolling up subfacets/categories
export const entityTopologyFacetProjectionSchema = z.object({
  title: z.string(),
  summary: z.string(),
  category: TopologyCategoryEnum,
  subfacets: z.preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z.array(z.string()).transform((arr) => arr.slice(0, 3)),
  ),
  // priority_hint: priorityHintSchema,
  // next_step_hint: z.string(),
  // influences: z.array(influenceSchema).nullable().optional().default([]),
});

// Subfacet-level rollup: a subfacet is the sum of its entities (existing + new)
export const subfacetTopologySchema = z.object({
  subfacet: z.string().describe('Subfacet/theme label'),
  category: TopologyCategoryEnum.describe(
    'Category this subfacet belongs to; choose from allowed set',
  ),
  summary: z
    .string()
    .describe('Updated subfacet summary aggregated from its entities'),
  updated: z
    .boolean()
    .default(false)
    .describe('Mark true when new entities were incorporated this pass'),
  entities: z
    .array(entityTopologyFacetProjectionSchema)
    .max(10)
    .describe('Entities that roll up under this subfacet'),
});

export type SubfacetTopology = z.infer<typeof subfacetTopologySchema>;

// Consolidation schema: merges overlapping subfacets to prevent proliferation
const consolidationSubfacetBase = z.object({
  name: consolidationSubfacetNameSchema.describe('Subfacet label'),
});
const constrainedConsolidationSubfacetBase = z.object({
  name: constrainedConsolidationSubfacetNameSchema.describe('Subfacet label'),
});

export const topologyConsolidationSchema = z.object({
  category: TopologyCategoryEnum.describe(
    'Category being consolidated; must match the provided category input',
  ),
  mergedSubfacets: z
    .array(
      consolidationSubfacetBase.extend({
        mergedFrom: z
          .array(z.string())
          .min(1)
          .describe('Original subfacet names that were merged'),
        summary: z
          .string()
          .describe(
            'Concise summary of the merged subfacet, grounded in entities',
          ),
        justification: z
          .string()
          .describe(
            'Why these subfacets belong together; include overlap rationale',
          ),
      }),
    )
    .describe('Merged/renamed subfacets produced by consolidation'),
  keptSubfacets: z
    .array(
      consolidationSubfacetBase.extend({
        reasonKept: z
          .string()
          .describe('Why this subfacet stays separate (e.g., distinct scope)'),
      }),
    )
    .describe('Subfacets explicitly kept separate'),
});

export type TopologyConsolidation = z.infer<typeof topologyConsolidationSchema>;
export const topologyConsolidationStrictSchema = z.object({
  category: TopologyCategoryEnum.describe(
    'Category being consolidated; must match the provided category input',
  ),
  mergedSubfacets: z
    .array(
      constrainedConsolidationSubfacetBase.extend({
        mergedFrom: z
          .array(z.string())
          .min(1)
          .describe('Original subfacet names that were merged'),
        summary: z
          .string()
          .describe(
            'Concise summary of the merged subfacet, grounded in entities',
          ),
        justification: z
          .string()
          .describe(
            'Why these subfacets belong together; include overlap rationale',
          ),
      }),
    )
    .describe('Merged/renamed subfacets produced by consolidation'),
  keptSubfacets: z
    .array(
      constrainedConsolidationSubfacetBase.extend({
        reasonKept: z
          .string()
          .describe('Why this subfacet stays separate (e.g., distinct scope)'),
      }),
    )
    .describe('Subfacets explicitly kept separate'),
});

// Category-level rollup: aggregates subfacets (which already aggregate entities)
export const categoryTopologySchema = z.object({
  category: TopologyCategoryEnum.describe(
    'Category being summarized; iterate across all allowed categories',
  ),
  summary: z
    .string()
    .describe('Category-level summary derived from its subfacets'),
});

export type CategoryTopology = z.infer<typeof categoryTopologySchema>;

// Category-level consolidation: synthesize multiple subfacet summaries into one rollup
export const categoryConsolidationSchema = z.object({
  category: TopologyCategoryEnum.describe(
    'Category being consolidated; must match the provided category input',
  ),
  summary: z
    .string()
    .describe(
      'Comprehensive high-level category summary grounded in subfacet summaries',
    ),
  briefSummary: z
    .string()
    .describe(
      'Single-paragraph, prompt-safe category brief grounded in subfacet summaries',
    ),
  subfacets: z
    .array(z.string())
    .describe('Subfacet names used to produce the consolidation'),
  crossCuttingThemes: z
    .array(z.string())
    .describe('Themes that span multiple subfacets'),
  criticalInsights: z
    .array(z.string())
    .describe('Key decisions/outcomes/constraints preserved from subfacets'),
});

export type CategorySummarization = z.infer<typeof categoryConsolidationSchema>;

// Subfacet-level summarization: rolls up entity summaries within a single subfacet
export const subfacetSummarizationSchema = z.object({
  category: TopologyCategoryEnum.describe(
    'Category for the subfacet; must match the provided category input',
  ),
  subfacet: z
    .string()
    .describe('Subfacet label being summarized (existing subfacet only)'),
  summary: z
    .string()
    .describe('Unified subfacet summary grounded in entity summaries'),
  entities: z
    .array(z.string())
    .describe('Entity identifiers or titles used to build the summary'),
  criticalInsights: z
    .array(z.string())
    .describe('Key decisions/outcomes/constraints within this subfacet'),
});

export type SubfacetSummarization = z.infer<typeof subfacetSummarizationSchema>;

// Top-level topology summary with per-category rollups
export const topLevelTopologySchema = z.object({
  overallSummary: z
    .string()
    .nullable()
    .optional()
    .describe('Optional global summary of the corpus or conversation'),
  categories: z
    .array(categoryTopologySchema)
    .min(1)
    .describe(
      'Category rollups; run once per allowed category and keep unchanged subfacets unless told to drop them',
    ),
});

export type TopLevelTopology = z.infer<typeof topLevelTopologySchema>;
