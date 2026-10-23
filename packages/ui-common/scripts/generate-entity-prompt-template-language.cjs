const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { resolveOpenapiRoot } = require("../../../scripts/openapi-source.cjs");

const outputPath = path.resolve(
  __dirname,
  "../src/generated/entity-prompt-template-language.ts",
);
const fixtureBasenamePattern = /entity[-_]prompt[-_]template[-_]language/i;
const supportedExtensions = new Set([".json", ".yaml", ".yml"]);

function isFixtureFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    supportedExtensions.has(extension) &&
    fixtureBasenamePattern.test(path.basename(filePath))
  );
}

function findFixture(root) {
  const preferredPaths = [
    "specs/api/fixtures/entity-prompt-template-language.json",
    "specs/api/fixtures/entity-prompt-template-language.yaml",
    "specs/api/fixtures/entity-prompt-template-language.yml",
    "specs/fixtures/entity-prompt-template-language.json",
    "specs/fixtures/entity-prompt-template-language.yaml",
    "specs/fixtures/entity-prompt-template-language.yml",
    "specs/fixtures/entity-prompt-template-language-v1.json",
    "specs/fixtures/entity-prompt-template-language-v1.yaml",
    "specs/fixtures/entity-prompt-template-language-v1.yml",
    "specs/schemas/entity-prompt-template-language.json",
    "specs/schemas/entity-prompt-template-language.yaml",
    "specs/schemas/entity-prompt-template-language.yml",
  ];

  for (const relativePath of preferredPaths) {
    const candidate = path.join(root, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      continue;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (isFixtureFile(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Unable to locate the entity prompt-template language fixture in ${root}`,
  );
}

function readFixture(fixturePath) {
  const source = fs.readFileSync(fixturePath, "utf8");
  return path.extname(fixturePath).toLowerCase() === ".json"
    ? JSON.parse(source)
    : yaml.load(source);
}

function getVersionEntries(source) {
  if (Array.isArray(source)) {
    return source.map((entry) => [entry.syntaxVersion, entry]);
  }

  if (source && typeof source === "object") {
    const record = source;
    if (typeof record.syntaxVersion === "string") {
      return [[record.syntaxVersion, record]];
    }
    const versions = record.languages ?? record.versions ?? record;
    if (Array.isArray(versions)) {
      return versions.map((entry) => [entry.syntaxVersion, entry]);
    }

    return Object.entries(versions).map(([version, entry]) => [version, entry]);
  }

  throw new Error(
    "Entity prompt-template language fixture must be an object or array",
  );
}

function getStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function normalizePathFamily(family, index, version) {
  if (typeof family === "string") {
    return { template: family, pattern: family };
  }

  if (!family || typeof family !== "object") {
    throw new Error(
      `Path family ${index} for ${version} must be an object or string`,
    );
  }

  const template = family.template ?? family.pathTemplate ?? family.name;
  const pattern =
    family.pattern ?? family.pathPattern ?? family.regex ?? template;
  if (typeof template !== "string" || typeof pattern !== "string") {
    throw new Error(
      `Path family ${index} for ${version} needs template and pattern strings`,
    );
  }

  return { template, pattern };
}

function normalizeLanguages(source) {
  const languages = {};
  for (const [version, rawEntry] of getVersionEntries(source)) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    const syntaxVersion = entry.syntaxVersion ?? version;
    if (typeof syntaxVersion !== "string") {
      throw new Error(
        "Each entity prompt-template language entry needs a syntaxVersion",
      );
    }

    const supportedPaths = getStringArray(
      entry.supportedPaths ?? entry.paths,
      `${syntaxVersion}.supportedPaths`,
    );
    const rawPathFamilies = entry.pathFamilies ?? entry.families;
    if (!Array.isArray(rawPathFamilies)) {
      throw new Error(`${syntaxVersion}.pathFamilies must be an array`);
    }

    if (
      JSON.stringify(entry.authoring?.paths?.map((path) => path.path)) !==
        JSON.stringify(supportedPaths) ||
      entry.authoring.paths.some((path) => !path.description) ||
      JSON.stringify(
        entry.authoring.pathFamilies.map(({ template, pattern }) => ({
          template,
          pattern,
        })),
      ) !== JSON.stringify(rawPathFamilies)
    ) {
      throw new Error(
        "Authoring metadata must describe every supported path and family in catalog order",
      );
    }
    languages[syntaxVersion] = {
      supportedPaths,
      authoring: entry.authoring,
      pathFamilies: rawPathFamilies.map((family, index) =>
        normalizePathFamily(family, index, syntaxVersion),
      ),
    };
  }

  if (Object.keys(languages).length === 0) {
    throw new Error(
      "Entity prompt-template language fixture contains no language versions",
    );
  }

  return languages;
}

function render(languages, fixturePath) {
  return [
    "// AUTO-GENERATED by scripts/generate-entity-prompt-template-language.cjs.",
    `// Source of truth: ${path.basename(
      fixturePath,
    )} in the OpenAPI repository.`,
    "",
    'import type { EntityPromptTemplateSyntaxVersion, EntityPromptTemplateAuthoringMetadataDto } from "../api";',
    "",
    "export interface EntityPromptTemplatePathFamilyMetadata {",
    "  readonly template: string;",
    "  readonly pattern: string;",
    "}",
    "",
    "export interface EntityPromptTemplateLanguageMetadata {",
    "  readonly authoring: EntityPromptTemplateAuthoringMetadataDto;",
    "  readonly supportedPaths: readonly string[];",
    "  readonly pathFamilies: readonly EntityPromptTemplatePathFamilyMetadata[];",
    "}",
    "",
    "export const ENTITY_PROMPT_TEMPLATE_LANGUAGES =",
    `${JSON.stringify(languages, null, 2)} satisfies Record<`,
    "  EntityPromptTemplateSyntaxVersion,",
    "  EntityPromptTemplateLanguageMetadata",
    ">;",
    "",
  ].join("\n");
}

const openApiRoot = resolveOpenapiRoot();
const fixturePath = findFixture(openApiRoot);
const languages = normalizeLanguages(readFixture(fixturePath));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, render(languages, fixturePath));
console.log(
  `Generated ${path.relative(process.cwd(), outputPath)} from ${fixturePath}`,
);
