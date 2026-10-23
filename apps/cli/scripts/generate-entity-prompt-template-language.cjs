const fs = require('node:fs');
const path = require('node:path');
const { resolveOpenapiRoot } = require('./openapi-root.cjs');

const fixturePath = path.join(
  resolveOpenapiRoot(),
  'specs',
  'fixtures',
  'entity-prompt-template-language-v1.json',
);
const outputDirectory = path.join(process.cwd(), 'src', 'shared', 'api', 'generated');
const outputPath = path.join(outputDirectory, 'entity-prompt-template-language.ts');
const indexPath = path.join(outputDirectory, 'index.ts');

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
// The fixture also carries editor authoring metadata. Only runtime language
// semantics belong in the CLI rendering contract.
const runtimeLanguage = {
  syntaxVersion: fixture.syntaxVersion,
  supportedPaths: fixture.supportedPaths,
  pathFamilies: fixture.pathFamilies,
  missingPathBehavior: fixture.missingPathBehavior,
  malformedSubstitutionBehavior: fixture.malformedSubstitutionBehavior,
  malformedSubstitutions: fixture.malformedSubstitutions,
};
if (
  fixture.syntaxVersion !== 'V1' ||
  fixture.missingPathBehavior !== 'ERROR' ||
  fixture.malformedSubstitutionBehavior !== 'ERROR' ||
  !Array.isArray(fixture.supportedPaths) ||
  !Array.isArray(fixture.pathFamilies) ||
  !Array.isArray(fixture.malformedSubstitutions)
) {
  throw new Error('Entity prompt-template language fixture does not match the V1 contract.');
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
  `import { EntityPromptTemplateSyntaxVersion } from './api.js';\n\n` +
  `export interface EntityPromptTemplatePathFamily {\n` +
  `  readonly template: string;\n` +
  `  readonly pattern: string;\n` +
  `}\n\n` +
  `export interface EntityPromptTemplateLanguage {\n` +
  `  readonly syntaxVersion: EntityPromptTemplateSyntaxVersion;\n` +
  `  readonly supportedPaths: readonly string[];\n` +
  `  readonly pathFamilies: readonly EntityPromptTemplatePathFamily[];\n` +
  `  readonly missingPathBehavior: 'ERROR';\n` +
  `  readonly malformedSubstitutionBehavior: 'ERROR';\n` +
  `  readonly malformedSubstitutions: readonly string[];\n` +
  `}\n\n` +
  `export const ENTITY_PROMPT_TEMPLATE_LANGUAGES = {\n` +
  `  [EntityPromptTemplateSyntaxVersion.V1]: ${JSON.stringify(runtimeLanguage, null, 2)},\n` +
  `} as const satisfies Readonly<Record<EntityPromptTemplateSyntaxVersion, EntityPromptTemplateLanguage>>;\n`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, generated);

const exportLine = 'export * from "./entity-prompt-template-language.js";';
const index = fs.readFileSync(indexPath, 'utf8');
const exportPattern = /^export \* from ['"]\.\/entity-prompt-template-language\.js['"];\n?/gmu;
const indexWithoutGeneratedExport = index.replace(exportPattern, '').trimEnd();
fs.writeFileSync(indexPath, `${indexWithoutGeneratedExport}\n${exportLine}\n`);
