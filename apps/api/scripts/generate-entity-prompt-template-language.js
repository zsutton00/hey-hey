const fs = require('fs');
const path = require('path');
const { resolveOpenapiRoot } = require('./openapi-root');
const { resolveGeneratedRoot } = require('./generated-root');

const fixturePath = path.join(
  resolveOpenapiRoot(),
  'specs',
  'fixtures',
  'entity-prompt-template-language-v1.json',
);
const outputPath = path.join(
  resolveGeneratedRoot(),
  'entity-prompt-template-language.ts',
);

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const expectedKeys = [
  'authoring',
  'malformedSubstitutionBehavior',
  'malformedSubstitutions',
  'missingPathBehavior',
  'pathFamilies',
  'supportedPaths',
  'syntaxVersion',
];
const actualKeys = Object.keys(fixture).sort();
if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  throw new Error(
    `Unexpected entity prompt-template fixture keys: ${actualKeys.join(', ')}`,
  );
}
if (
  fixture.syntaxVersion !== 'V1' ||
  fixture.missingPathBehavior !== 'ERROR' ||
  fixture.malformedSubstitutionBehavior !== 'ERROR' ||
  !Array.isArray(fixture.supportedPaths) ||
  !Array.isArray(fixture.pathFamilies) ||
  !Array.isArray(fixture.malformedSubstitutions)
) {
  throw new Error(
    'Entity prompt-template language fixture does not match the V1 contract.',
  );
}

const requiredStructuredPaths = [
  'entity.sections',
  'context.relatedEntities',
  'context.featureHierarchy',
  'context.proposals',
  'context.agentSessions',
];
for (const requiredPath of requiredStructuredPaths) {
  if (!fixture.supportedPaths.includes(requiredPath)) {
    throw new Error(
      `Entity prompt-template V1 fixture is missing structured path: ${requiredPath}`,
    );
  }
}
if (new Set(fixture.supportedPaths).size !== fixture.supportedPaths.length) {
  throw new Error('Entity prompt-template V1 fixture contains duplicate paths.');
}

const generated =
  `// Generated from specs/fixtures/entity-prompt-template-language-v1.json. Do not edit.\n` +
  `import { EntityPromptTemplateSyntaxVersion } from './model/entityPromptTemplateSyntaxVersion';\n\n` +
  `export interface EntityPromptTemplatePathFamily {\n` +
  `  readonly template: string;\n` +
  `  readonly pattern: string;\n` +
  `}\n\n` +
  `import type { EntityPromptTemplateAuthoringMetadataDto } from './model/entityPromptTemplateAuthoringMetadataDto';\n` +
  `export interface EntityPromptTemplateLanguage {\n` +
  `  readonly authoring: EntityPromptTemplateAuthoringMetadataDto;\n` +
  `  readonly syntaxVersion: EntityPromptTemplateSyntaxVersion;\n` +
  `  readonly supportedPaths: readonly string[];\n` +
  `  readonly pathFamilies: readonly EntityPromptTemplatePathFamily[];\n` +
  `  readonly missingPathBehavior: 'ERROR';\n` +
  `  readonly malformedSubstitutionBehavior: 'ERROR';\n` +
  `  readonly malformedSubstitutions: readonly string[];\n` +
  `}\n\n` +
  `export const ENTITY_PROMPT_TEMPLATE_LANGUAGES = {\n` +
  `  [EntityPromptTemplateSyntaxVersion.V1]: ${JSON.stringify(fixture, null, 2)},\n` +
  `} satisfies Readonly<Record<EntityPromptTemplateSyntaxVersion, EntityPromptTemplateLanguage>>;\n`;

fs.writeFileSync(outputPath, generated);
