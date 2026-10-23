export type { WorkItemTypeDefinitionDto } from '../../shared/api/index';
import type { WorkItemTypeDefinitionDto } from '../../shared/api/index';
import { FeatureTag } from '../../shared/agent-bridge-contract/generated/api';

/** The platform-owned work-item key that participates in product Feature hierarchy. */
const PLATFORM_FEATURE_TYPE_KEY = 'FEATURE';

/** Product Feature hierarchy is identified by the platform-owned type key. */
export const isPlatformFeatureType = (def: WorkItemTypeDefinitionDto): boolean =>
  def.key === PLATFORM_FEATURE_TYPE_KEY;

/**
 * Renders one work-item type definition as a single ontology entry string
 * suitable for embedding in an agent system prompt. Only axes the definition
 * actually declares are rendered — absent axes produce no output.
 */
export function renderWorkItemTypeOntologyEntry(def: WorkItemTypeDefinitionDto): string {
  const description = def.description?.trim().replace(/\.+$/u, '');
  const clauses: string[] = [
    description
      ? `**${def.name}** (\`${def.key}\`) — ${description}`
      : `**${def.name}** (\`${def.key}\`)`,
  ];

  if (def.role) {
    clauses.push(`Role: \`${def.role}\``);
  }

  if (def.allowedParentTypes?.length === 0) {
    clauses.push('Top-level only');
  }

  return `- ${clauses.join('. ')}.`;
}

/** Backtick-quoted, comma-joined list of all FeatureTag values in enum order. */
export const renderFeatureTagList = (): string =>
  Object.values(FeatureTag)
    .map((tag) => `\`${tag}\``)
    .join(', ');

/**
 * Full tag-vocabulary clause for embedding in the FEATURE ontology entry:
 * the tag list with the AI gloss and the product-default note.
 */
export const renderFeatureTagVocabulary = (): string =>
  `${renderFeatureTagList()} — where \`AI\` marks AI/agent-shaped delivery (prompts, agent orchestration, runners) rather than ordinary backend code; \`product\` is the default for a top-level feature`;
