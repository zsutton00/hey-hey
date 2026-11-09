const fs = require("node:fs");
const path = require("node:path");

const brandNames = new Map([
  ["project", "ProjectId"],
  ["user", "UserId"],
  ["organization", "OrganizationId"],
  ["conversation", "ConversationId"],
  ["workflow", "WorkflowId"],
  ["message", "MessageId"],
  ["artifact", "ArtifactId"],
  ["proposal", "ProposalId"],
  ["interaction type", "InteractionTypeId"],
  ["organization member", "OrganizationMemberId"],
  ["request", "RequestId"],
  ["job", "JobId"],
  ["initiative", "InitiativeId"],
  ["task", "TaskId"],
  ["integration", "IntegrationId"],
  ["llm", "LlmId"],
  ["implementation hint", "ImplementationHintId"],
  ["validation session", "ValidationSessionId"],
]);

const generatedRoot = path.resolve(process.argv[2]);
if (!process.argv[2]) {
  throw new Error("Usage: node postprocess-brands.cjs <generated-root>");
}

const collectDeclarations = (directory) => {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(file);
      } else if (entry.isFile() && file.endsWith(".ts")) {
        files.push(file);
      }
    }
  };
  visit(directory);

  // Build the inheritance lookup only after every object intersection has
  // been materialized. Otherwise a child converted later in visit() cannot
  // inherit its parents' runtime enum namespaces on a fresh generation.
  let normalizedAny;
  do {
    normalizedAny = false;
    for (const file of files) {
      const original = fs.readFileSync(file, "utf8");
      const normalized = materializeObjectIntersections(original, file);
      if (normalized !== original) {
        fs.writeFileSync(file, normalized);
        normalizedAny = true;
      }
    }
  } while (normalizedAny);

  const interfaces = new Map();
  const enums = new Map();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const interfaceDeclarations = [
      ...source.matchAll(
        /^export interface (\w+)(?: extends ([^{]+))?\s*\{([\s\S]*?)^\}/gm,
      ),
      ...source.matchAll(
        /^export interface (\w+)(?: extends ([^{]+))?\s*\{\s*\}/gm,
      ),
    ];
    for (const [
      ,
      name,
      extendsClause = "",
      body = "",
    ] of interfaceDeclarations) {
      interfaces.set(name, {
        file,
        bases: extendsClause
          .split(",")
          .map((base) => base.trim().replace(/<.*$/, ""))
          .filter(Boolean),
        properties: [
          ...body.matchAll(/^\s*'([^']+)'(\?)?:\s*([^;\n]+);/gm),
        ].map(([, propertyName, optional, type]) => ({
          propertyName,
          optional: Boolean(optional),
          type,
        })),
      });
    }
    for (const [, name] of source.matchAll(/^export const (\w+)\s*=/gm)) {
      if (new RegExp(`^export type ${name} =`, "m").test(source)) {
        enums.set(name, file);
      }
    }
  }
  const enumOrder = new Map(
    [...enums.keys()].map((name, index) => [name, index]),
  );
  return { interfaces, enums, enumOrder };
};

const addEnumNamespaces = (source, file, declarations) => {
  const interfaces = [...source.matchAll(/^export interface (\w+)\b/gm)].map(
    ([, name]) => name,
  );
  if (interfaces.length === 0) return source;

  let result = source;
  const imports = new Map();
  for (const modelName of interfaces) {
    const aliases = new Map();
    const visited = new Set();
    const collect = (currentName) => {
      if (visited.has(currentName)) return;
      visited.add(currentName);
      const declaration = declarations.interfaces.get(currentName);
      if (!declaration) return;

      for (const { propertyName: fieldName, type } of declaration.properties) {
        const namespaceProperty = `${fieldName[0].toUpperCase()}${fieldName.slice(1)}Enum`;
        // Look up the identifiers in this type instead of compiling a regular
        // expression for every enum in the specification for every property.
        // Keep declaration order when a union mentions more than one enum.
        const enumNames = [...new Set(type.match(/\b\w+\b/g) ?? [])]
          .filter((name) => declarations.enums.has(name))
          .sort(
            (left, right) =>
              declarations.enumOrder.get(left) -
              declarations.enumOrder.get(right),
          );
        for (const enumName of enumNames) {
          if (aliases.has(namespaceProperty)) continue;
          aliases.set(namespaceProperty, {
            enumName,
            file: declarations.enums.get(enumName),
          });
        }
      }
      for (const base of declaration.bases) collect(base);
    };
    collect(modelName);

    const namespace =
      result.match(
        new RegExp(`export namespace ${modelName}\\s*\\{([\\s\\S]*?)^\\}`, "m"),
      )?.[1] ?? "";
    const missingAliases = [...aliases].filter(
      ([propertyName]) =>
        !new RegExp(`export const ${propertyName}\\b`).test(namespace) ||
        !new RegExp(`export type ${propertyName}\\b`).test(namespace),
    );
    if (missingAliases.length === 0) continue;

    for (const [, alias] of missingAliases) {
      if (alias.file === file) continue;
      let specifier = path
        .relative(path.dirname(file), alias.file)
        .replace(/\\/g, "/")
        .replace(/\.ts$/, ".js");
      if (!specifier.startsWith(".")) specifier = `./${specifier}`;
      const names = imports.get(specifier) ?? new Set();
      names.add(alias.enumName);
      imports.set(specifier, names);
    }

    const aliasText = missingAliases
      .map(
        ([propertyName, { enumName }]) =>
          `    export const ${propertyName} = ${enumName};\n    export type ${propertyName} = ${enumName};`,
      )
      .join("\n");
    const existingNamespace = new RegExp(
      `^export namespace ${modelName}\\s*\\{([\\s\\S]*?)^\\}`,
      "m",
    );
    if (existingNamespace.test(result)) {
      result = result.replace(
        existingNamespace,
        (_match, body) =>
          `export namespace ${modelName} {${body.trimEnd()}\n${aliasText}\n}`,
      );
    } else {
      const inlineEmptyInterface = new RegExp(
        `(^export interface ${modelName}\\b[^\\n]*\\{\\s*\\})`,
        "m",
      );
      const interfaceDeclaration = inlineEmptyInterface.test(result)
        ? inlineEmptyInterface
        : new RegExp(`(^export interface ${modelName}\\b[\\s\\S]*?^\\})`, "m");
      result = result.replace(
        interfaceDeclaration,
        `$1\n\nexport namespace ${modelName} {\n${aliasText}\n}`,
      );
    }
  }

  const importStatements = [...imports].flatMap(([specifier, names]) => {
    const importedValues = new Set();
    for (const [, typeOnly, imported, currentSpecifier] of result.matchAll(
      /^import (type )?\{([^}]+)\} from ['"]([^'"]+)['"];?$/gm,
    )) {
      if (typeOnly || currentSpecifier !== specifier) continue;
      for (const entry of imported.split(",")) {
        importedValues.add(entry.trim().split(/\s+as\s+/)[0]);
      }
    }
    const missing = [...names].filter((name) => !importedValues.has(name));
    return missing.length > 0
      ? [`import { ${missing.sort().join(", ")} } from '${specifier}';`]
      : [];
  });
  if (importStatements.length === 0) return result;

  const importPosition = result.search(/^import\b/m);
  const insertAt = result.startsWith("// @ts-nocheck\n")
    ? result.indexOf("\n") + 1
    : importPosition < 0
      ? 0
      : importPosition;
  return `${result.slice(0, insertAt)}${importStatements.join("\n")}\n${result.slice(insertAt)}`;
};

const addOriginalEnumAliases = (source) =>
  source.replace(
    /export const (\w+) = \{([\s\S]*?)\n\} as const;/g,
    (declaration, enumName, body) => {
      const lines = body.split("\n");
      const seen = new Set();
      const uniqueLines = lines.filter((line) => {
        const entry = line.match(
          /^[ \t]*(?:"([^"]+)"|([\w$]+)):[ \t]*(['"])(.*?)\3,?[ \t]*$/,
        );
        if (!entry) return true;
        const key = entry[1] ?? entry[2];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const normalizedBody = uniqueLines.join("\n");
      const entries = [
        ...normalizedBody.matchAll(
          /^[ \t]*(?:"([^"]+)"|([\w$]+)):[ \t]*(['"])(.*?)\3,?[ \t]*$/gm,
        ),
      ].map(([, quotedKey, bareKey, , value]) => ({
        key: quotedKey ?? bareKey,
        value,
      }));
      if (entries.length === 0) return declaration;

      const keys = new Set(entries.map(({ key }) => key));
      const aliases = new Map();
      for (const { key, value } of entries) {
        if (!/^[A-Za-z_$][\w$]*$/.test(value) || value === key) continue;
        aliases.set(value, { sourceKey: key, value });
      }

      const addedEntries = [];
      for (const [key, { value }] of aliases) {
        if (keys.has(key)) continue;
        keys.add(key);
        addedEntries.push(
          `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
        );
      }

      const outputBody =
        addedEntries.length > 0 ? normalizedBody.trimEnd() : normalizedBody;
      const separator =
        addedEntries.length > 0 &&
        outputBody.trimEnd() &&
        !outputBody.trimEnd().endsWith(",")
          ? ","
          : "";
      const object = `export const ${enumName} = {${outputBody}${addedEntries.length > 0 ? `${separator}\n${addedEntries.join(",\n")},` : ""}\n} as const;`;
      const hiddenAliases = [...aliases]
        .filter(([key, { sourceKey }]) => key !== sourceKey && keys.has(key))
        .map(
          ([key, { sourceKey }]) =>
            `Object.defineProperty(${enumName}, ${JSON.stringify(key)}, { enumerable: false, value: ${enumName}[${JSON.stringify(sourceKey)}] });`,
        )
        .filter((statement) => !source.includes(statement));

      return `${object}${hiddenAliases.length > 0 ? `\n${hiddenAliases.join("\n")}` : ""}`;
    },
  );

const moveRuntimeEnumNamespacesAfterDeclarations = (source) => {
  let result = source;
  const namespaces = [
    ...result.matchAll(/^export namespace (\w+)\s*\{([\s\S]*?)^\}/gm),
  ].reverse();

  for (const [namespaceText, modelName, namespaceBody] of namespaces) {
    const namespaceStart = result.indexOf(namespaceText);
    if (namespaceStart < 0) continue;

    const namespaceEnd = namespaceStart + namespaceText.length;
    const enumNames = [
      ...namespaceBody.matchAll(/\bexport const \w+ = (\w+);/g),
    ].map(([, enumName]) => enumName);
    const declarationEnds = enumNames
      .map((enumName) => {
        const declaration = new RegExp(
          `^export const ${enumName} = \\{[\\s\\S]*?^\\} as const;[\\s\\S]*?^export type ${enumName} = [^\\n]+;`,
          "m",
        ).exec(result);
        return declaration ? declaration.index + declaration[0].length : -1;
      })
      .filter((end) => end > namespaceEnd);
    if (declarationEnds.length === 0) continue;

    const insertionPoint = Math.max(...declarationEnds);
    const withoutNamespace =
      result.slice(0, namespaceStart) + result.slice(namespaceEnd);
    const adjustedInsertionPoint = insertionPoint - namespaceText.length;
    result =
      withoutNamespace.slice(0, adjustedInsertionPoint) +
      `\n\n${namespaceText}` +
      withoutNamespace.slice(adjustedInsertionPoint);
  }

  return result;
};

const postprocessAxiosCommon = (commonFile) => {
  if (!fs.existsSync(commonFile)) return;

  const original = fs.readFileSync(commonFile, "utf8");
  const generatedSignature =
    "export const createRequestFunction = function (axiosArgs: RequestArgs, globalAxios: AxiosInstance, BASE_PATH: string, configuration?: Configuration) {";
  const typedSignature =
    "type AxiosRequestFunction = <T = unknown, R = AxiosResponse<T>>(axios?: AxiosInstance, basePath?: string) => Promise<R>;\n\nexport const createRequestFunction = function (axiosArgs: RequestArgs, globalAxios: AxiosInstance, BASE_PATH: string, configuration?: Configuration): AxiosRequestFunction {";
  const generatedReturn =
    "return <T = unknown, R = AxiosResponse<T>>(axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH) => {";
  const typedReturn =
    "return <T = unknown, R = AxiosResponse<T>>(axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH): Promise<R> => {";

  if (original.includes(typedSignature) && original.includes(typedReturn))
    return;
  if (
    !original.includes(generatedSignature) ||
    !original.includes(generatedReturn)
  ) {
    throw new Error(
      `Generated Axios request helper has changed: ${commonFile}`,
    );
  }

  fs.writeFileSync(
    commonFile,
    original
      .replace(generatedSignature, typedSignature)
      .replace(generatedReturn, typedReturn),
  );
};

const materializeObjectIntersections = (source, file) => {
  const importedModels = new Map();
  for (const [, names, specifier] of source.matchAll(
    /^import type \{([^}]+)\} from ['"]([^'"]+)['"];?$/gm,
  )) {
    const importedPath = path.resolve(path.dirname(file), specifier);
    const typescriptPath = importedPath.endsWith(".js")
      ? importedPath.slice(0, -3) + ".ts"
      : importedPath.endsWith(".ts")
        ? importedPath
        : `${importedPath}.ts`;
    for (const name of names.split(",")) {
      const importedName = name
        .trim()
        .split(/\s+as\s+/)
        .at(-1);
      if (importedName) importedModels.set(importedName, typescriptPath);
    }
  }

  const isInterface = (name) => {
    if (new RegExp(`^export interface ${name}\\b`, "m").test(source)) {
      return true;
    }
    const importedPath = importedModels.get(name);
    if (!importedPath || !fs.existsSync(importedPath)) return false;
    const importedSource = fs.readFileSync(importedPath, "utf8");
    return new RegExp(`^export interface ${name}\\b`, "m").test(importedSource);
  };

  return source.replace(
    /^export type (\w+) = ([\w]+(?:\s*&\s*[\w]+)*);$/gm,
    (declaration, modelName, expression) => {
      const bases = expression.split(/\s*&\s*/);
      if (!bases.every(isInterface)) return declaration;
      return `export interface ${modelName} extends ${bases.join(", ")} {}`;
    },
  );
};

const visit = (directory, declarations) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(file, declarations);
      continue;
    }
    if (!entry.isFile() || !file.endsWith(".ts")) continue;

    const original = fs.readFileSync(file, "utf8");
    const usedBrands = new Set();
    const importedBrands = new Set();
    let source = original.replace(
      /^import type \{([^}]+)\} from ['"][^'\"]*brands\.js['"];?\s*\n?/gm,
      (_statement, names) => {
        for (const name of names.split(",")) importedBrands.add(name.trim());
        return "";
      },
    );
    source = source.replace(
      /^([ \t]*'[^']+'\??:\s*)(\w+)(\s*(?:\|\s*null\s*)?)([;,])/gm,
      (declaration, prefix, type, nullable, terminator) =>
        importedBrands.has(type)
          ? `${prefix}string${nullable}${terminator}`
          : declaration,
    );
    source = source.replace(
      /(^|\n)([ \t]*'[^']+'\??:\s*)string(\s*(?:\|\s*null\s*)?)([;,])/g,
      (declaration, linePrefix, prefix, nullable, terminator, offset) => {
        const beforeProperty = source.slice(0, offset + linePrefix.length);
        const commentEnd = beforeProperty.lastIndexOf("*/");
        if (
          commentEnd < 0 ||
          !/^\s*$/.test(beforeProperty.slice(commentEnd + 2))
        ) {
          return declaration;
        }

        const commentStart = beforeProperty.lastIndexOf("/**", commentEnd);
        if (commentStart < 0) return declaration;

        const description = beforeProperty
          .slice(commentStart, commentEnd)
          .match(/\*\s*([^\n]*\(branded type\)[^\n]*)/i)?.[1];
        if (!description) return declaration;

        const lowered = description.toLowerCase();
        for (const [kind, brand] of brandNames) {
          if (
            lowered.includes(`for a ${kind}`) ||
            lowered.includes(`for an ${kind}`) ||
            lowered.includes(`${kind} identifier`)
          ) {
            usedBrands.add(brand);
            return `${linePrefix}${prefix}${brand}${nullable}${terminator}`;
          }
        }
        return declaration;
      },
    );
    source = materializeObjectIntersections(source, file);
    source = addOriginalEnumAliases(source);
    source = addEnumNamespaces(source, file, declarations);
    source = moveRuntimeEnumNamespacesAfterDeclarations(source);
    source = source.replace(
      /^import (\{[^\n]+\}) from ['"]([^./][^'"]+\.js)['"];?$/gm,
      (statement, importedNames, specifier) => {
        const names = importedNames
          .slice(1, -1)
          .split(",")
          .map((name) => name.trim().split(/\s+as\s+/)[0]);
        return names.some((name) => declarations.enums.has(name))
          ? statement.replace(`'${specifier}'`, `'./${specifier}'`)
          : statement;
      },
    );
    source = source.replace(
      /^((?:import [^\n]+\n)+)(\/\/ @ts-nocheck\n)/,
      "$2$1",
    );

    if (usedBrands.size === 0) {
      if (source !== original) fs.writeFileSync(file, source);
      continue;
    }
    const brandImport = path
      .relative(
        path.dirname(file),
        path.join(path.dirname(generatedRoot), "brands.js"),
      )
      .split(path.sep)
      .join("/");
    const importStatement = `import type { ${[...usedBrands].sort().join(", ")} } from '${brandImport}';\n`;
    const firstLineEnd = source.indexOf("\n");
    const insertAt = source.startsWith("// @ts-nocheck\n")
      ? firstLineEnd + 1
      : 0;
    const output =
      source.slice(0, insertAt) + importStatement + source.slice(insertAt);
    if (output !== original) fs.writeFileSync(file, output);
  }
};

const targets = process.argv[3]
  ? process.argv[3].split(",")
  : ["api", "agent-bridge", "local"];

for (const target of targets) {
  const models = path.join(generatedRoot, target, "models");
  if (fs.existsSync(models)) {
    visit(models, collectDeclarations(models));
  }

  postprocessAxiosCommon(path.join(generatedRoot, target, "common.ts"));
}
