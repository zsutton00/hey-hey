const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const {
  listSpecReferenceClosure,
} = require("../../../scripts/openapi-source.cjs");

const readInterface = (source, modelName) => {
  const emptyMatch = source.match(
    new RegExp(
      `^export interface ${modelName}(?: extends ([^{]+))?\\s*\\{\\s*\\}`,
      "m",
    ),
  );
  const match =
    emptyMatch ??
    source.match(
      new RegExp(
        `^export interface ${modelName}(?: extends ([^{]+))?\\s*\\{([\\s\\S]*?)^\\}`,
        "m",
      ),
    );
  if (!match) return null;
  const extendsClause = match[1] ?? "";
  const body = emptyMatch ? "" : match[2];

  const properties = new Map(
    [...body.matchAll(/^\s*'([^']+)'(\?)?:\s*([^;\n]+);/gm)].map(
      ([, name, optional, type]) => [
        name,
        { optional: Boolean(optional), type },
      ],
    ),
  );

  return {
    body,
    bases: extendsClause
      .split(",")
      .map((base) => base.trim().replace(/<.*$/, ""))
      .filter(Boolean),
    properties,
  };
};

const decodePointerSegment = (segment) =>
  segment.replace(/~1/g, "/").replace(/~0/g, "~");

const kebabCase = (value) =>
  value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();

const groupDiscriminatorBranches = (source, modelName, field) => {
  const declaration = new RegExp(`^export type ${modelName} = (.+);$`, "m");
  const expression = source.match(declaration)?.[1];
  if (!expression) {
    return source;
  }
  const branch =
    /\{\s*(\w+)\s*:\s*('[^']*'|"[^"]*"|true|false)\s*\}\s*&\s*(\w+)/g;
  const branches = [...expression.matchAll(branch)];
  const remainder = expression.replace(branch, "").replace(/[\s|]/g, "");
  if (remainder || branches.some((match) => match[1] !== field)) {
    return source;
  }
  const groups = new Map();
  for (const [, , literal, model] of branches) {
    const values = groups.get(model) ?? new Set();
    values.add(literal);
    groups.set(model, values);
  }
  if (groups.size === branches.length) {
    return source;
  }
  const grouped = [...groups]
    .map(
      ([model, values]) =>
        `{ ${field}: ${[...values].join(" | ")} } & ${model}`,
    )
    .join(" | ");
  return source.replace(declaration, `export type ${modelName} = ${grouped};`);
};

const collectSchemaMaps = (openapiRoot, yaml, specification) => {
  const maps = new Map();
  const entrySpec = `specs/${specification}/openapi.yaml`;
  if (fs.existsSync(path.join(openapiRoot, entrySpec))) {
    for (const file of listSpecReferenceClosure(openapiRoot, entrySpec)) {
      const absolute = path.join(openapiRoot, file);
      maps.set(absolute, yaml.load(fs.readFileSync(absolute, "utf8")));
    }
    return maps;
  }
  const visitDirectory = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(file);
        continue;
      }
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;

      const content = yaml.load(fs.readFileSync(file, "utf8"));
      maps.set(path.resolve(file), content);
    }
  };
  visitDirectory(path.join(openapiRoot, "specs", "schemas"));
  const apiSpec = path.join(
    openapiRoot,
    "specs",
    specification,
    "openapi.yaml",
  );
  if (fs.existsSync(apiSpec)) {
    maps.set(apiSpec, yaml.load(fs.readFileSync(apiSpec, "utf8")));
  }
  return maps;
};

const resolveSchemaRef = (
  ref,
  currentFile,
  schemaMaps,
  yaml,
  seen = new Set(),
) => {
  const [refFile, pointer = ""] = ref.split("#", 2);
  const resolvedFile = refFile
    ? path.resolve(path.dirname(currentFile), refFile)
    : currentFile;
  let document = schemaMaps.get(resolvedFile);
  if (!document && fs.existsSync(resolvedFile)) {
    document = yaml.load(fs.readFileSync(resolvedFile, "utf8"));
    schemaMaps.set(resolvedFile, document);
  }
  if (!document) return null;

  let schema = document;
  for (const segment of pointer.split("/").filter(Boolean)) {
    schema = schema?.[decodePointerSegment(segment)];
  }
  if (!schema || typeof schema !== "object") return null;

  const modelName = decodePointerSegment(
    pointer.split("/").filter(Boolean).at(-1) ?? "",
  );
  const identity = `${resolvedFile}#${pointer}`;
  if (seen.has(identity)) {
    throw new Error(`Cyclic schema alias: ${identity}`);
  }
  seen.add(identity);
  if (schema?.$ref) {
    const resolved = resolveSchemaRef(
      schema.$ref,
      resolvedFile,
      schemaMaps,
      yaml,
      seen,
    );
    return {
      modelName,
      schema: resolved?.schema,
      file: resolved?.file,
    };
  }
  return { modelName, schema, file: resolvedFile };
};

const discriminatorFieldValues = (
  schema,
  field,
  currentFile,
  schemaMaps,
  yaml,
  seen = new Set(),
) => {
  if (!schema || seen.has(schema)) {
    return undefined;
  }
  const visited = new Set(seen).add(schema);
  const property = schema.properties?.[field];
  if (property?.enum) {
    return new Set(property.enum);
  }
  const constraints = [];
  for (const branch of schema.allOf ?? []) {
    const resolved = branch.$ref
      ? resolveSchemaRef(branch.$ref, currentFile, schemaMaps, yaml)
      : { schema: branch };
    if (
      resolved?.schema?.discriminator?.propertyName === field &&
      typeof schema["x-discriminator-value"] === "string"
    ) {
      return new Set([schema["x-discriminator-value"]]);
    }
    const values = discriminatorFieldValues(
      resolved?.schema,
      field,
      resolved?.file ?? currentFile,
      schemaMaps,
      yaml,
      visited,
    );
    if (values) {
      constraints.push(values);
    }
  }
  if (constraints.length === 0) {
    return undefined;
  }
  return constraints.reduce(
    (values, constraint) =>
      new Set([...values].filter((value) => constraint.has(value))),
  );
};

const discriminatorValues = (schema, currentFile, schemaMaps, yaml) => {
  const explicit = Object.keys(schema.discriminator.mapping ?? {});
  if (explicit.length > 0) {
    return explicit;
  }
  const values = new Set();
  for (const branch of schema.oneOf ?? schema.anyOf ?? []) {
    const resolved = branch.$ref
      ? resolveSchemaRef(branch.$ref, currentFile, schemaMaps, yaml)
      : { schema: branch };
    for (const value of discriminatorFieldValues(
      resolved?.schema,
      schema.discriminator.propertyName,
      resolved?.file ?? currentFile,
      schemaMaps,
      yaml,
    ) ?? []) {
      values.add(value);
    }
  }
  return [...values];
};

const addOverrides = (modelFile, modelName, model, additions) => {
  if (!model || additions.length === 0) return false;
  const missing = additions.filter(({ name }) => !model.properties.has(name));

  const lines = missing.map(
    ({ name, optional, type }) =>
      `    '${name}'${optional ? "?" : ""}: ${type};`,
  );
  const interfacePattern = new RegExp(
    `(^export interface ${modelName}(?: extends [^{]+)?\\s*\\{)([\\s\\S]*?)^\\}`,
    "m",
  );
  const emptyInterfacePattern = new RegExp(
    `(^export interface ${modelName}(?: extends [^{]+)?\\s*\\{)\\s*\\}`,
    "m",
  );
  const original = fs.readFileSync(modelFile, "utf8");
  let canonical = original;
  for (const { name, optional, type } of additions) {
    const current = model.properties.get(name);
    if (!current || !/^(?:NonNullable|Exclude)</.test(current.type)) {
      continue;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    canonical = canonical.replace(
      new RegExp(`^(\\s*['"]${escaped}['"])\\??:\\s*[^;\\n]+;`, "m"),
      `$1${optional ? "?" : ""}: ${type};`,
    );
  }
  const updated =
    missing.length === 0
      ? canonical
      : emptyInterfacePattern.test(canonical)
        ? canonical.replace(
            emptyInterfacePattern,
            (_match, opening) => `${opening}\n${lines.join("\n")}\n}`,
          )
        : canonical.replace(
            interfacePattern,
            (_match, opening, body) =>
              `${opening}${body}\n${lines.join("\n")}\n}`,
          );
  if (updated === original) return false;
  fs.writeFileSync(modelFile, updated);
  return true;
};

function postprocessAllOfOverrides(generatedDirectory, openapiRoot) {
  const requireFromOpenapi = createRequire(
    path.join(openapiRoot, "package.json"),
  );
  const yaml = requireFromOpenapi("js-yaml");
  const modelsDirectory = path.join(generatedDirectory, "models");
  const targetName = path.basename(generatedDirectory);
  const specification = targetName === "agent-bridge" ? targetName : "api";
  const schemaMaps = collectSchemaMaps(openapiRoot, yaml, specification);
  const generatedSources = new Map();

  const commonSchema = schemaMaps.get(
    path.join(openapiRoot, "specs", "schemas", "common.yaml"),
  );
  if (
    commonSchema?.ApiResponse?.properties?.data?.["x-typescript-type"] ===
    "unknown"
  ) {
    const apiResponseFile = path.join(modelsDirectory, "api-response.ts");
    if (fs.existsSync(apiResponseFile)) {
      const source = fs.readFileSync(apiResponseFile, "utf8");
      const dataProperty =
        /^(\s*['"]data['"]\??:\s*)(any(?:\s*\|\s*null)?|unknown)(\s*;)/m;
      const match = source.match(dataProperty);
      if (!match) {
        throw new Error(
          "Generated ApiResponse.data does not match its declared unknown type.",
        );
      }
      if (match[2] !== "unknown") {
        fs.writeFileSync(
          apiResponseFile,
          source.replace(dataProperty, "$1unknown$3"),
        );
      }
    }
  }

  const getGeneratedModel = (name) => {
    if (generatedSources.has(name)) return generatedSources.get(name);
    const file = path.join(modelsDirectory, `${kebabCase(name)}.ts`);
    if (!fs.existsSync(file)) {
      generatedSources.set(name, null);
      return null;
    }
    const source = fs.readFileSync(file, "utf8");
    const model = readInterface(source, name);
    const result = model ? { file, modelName: name, source, model } : null;
    generatedSources.set(name, result);
    return result;
  };

  let updatedCount = 0;
  for (const [schemaFile, document] of schemaMaps) {
    const definitions = document?.components?.schemas ?? document;
    if (!definitions || typeof definitions !== "object") continue;

    const modelSchemas = Object.entries(definitions);
    for (const pathItem of Object.values(document?.paths ?? {})) {
      for (const method of [
        "get",
        "put",
        "post",
        "delete",
        "options",
        "head",
        "patch",
        "trace",
      ]) {
        const operation = pathItem?.[method];
        if (!operation?.operationId) {
          continue;
        }
        const operationName = operation.operationId.replace(
          /(^|[_\-.])(\w)/g,
          (_match, _separator, character) => character.toUpperCase(),
        );
        for (const [status, response] of Object.entries(
          operation.responses ?? {},
        )) {
          const schema = response?.content?.["application/json"]?.schema;
          if (schema && !schema.$ref) {
            modelSchemas.push([
              `${operationName}${status === "default" ? "Default" : status}Response`,
              schema,
            ]);
          }
        }
      }
    }
    for (const [modelName, schema] of modelSchemas) {
      for (const composition of ["oneOf", "anyOf"]) {
        for (const [index, branch] of (schema?.[composition] ?? []).entries()) {
          if (branch && typeof branch === "object" && !branch.$ref) {
            const suffix = composition === "oneOf" ? "OneOf" : "AnyOf";
            modelSchemas.push([`${modelName}${suffix}${index || ""}`, branch]);
          }
        }
      }

      const modelFile = path.join(
        modelsDirectory,
        `${kebabCase(modelName)}.ts`,
      );
      if (fs.existsSync(modelFile)) {
        const original = fs.readFileSync(modelFile, "utf8");
        let source = original;
        for (const [field, property] of Object.entries(
          schema?.properties ?? {},
        )) {
          if (property?.type !== "boolean" || property.enum?.length !== 1) {
            continue;
          }
          const literal = property.enum[0];
          if (typeof literal !== "boolean") {
            continue;
          }
          const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          source = source.replace(
            new RegExp(`(['"]${escaped}['"]\\??:\\s*)boolean\\b`, "g"),
            `$1${literal}`,
          );
        }
        const discriminator = schema?.discriminator;
        if (discriminator?.propertyName) {
          const values = discriminatorValues(
            schema,
            schemaFile,
            schemaMaps,
            yaml,
          );
          const declaration = `export const ${modelName}DiscriminatorValues = ${JSON.stringify(values)} as const;`;
          const existing = new RegExp(
            `^export const ${modelName}DiscriminatorValues = .*;$`,
            "m",
          );
          source = existing.test(source)
            ? source.replace(existing, declaration)
            : `${source.trimEnd()}\n\n${declaration}\n`;
          const field = discriminator.propertyName;
          const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          for (const [value, ref] of Object.entries(
            discriminator.mapping ?? {},
          )) {
            const variant = resolveSchemaRef(ref, schemaFile, schemaMaps, yaml);
            if (
              variant?.schema?.properties?.[field]?.type !== "boolean" ||
              !["true", "false"].includes(value)
            ) {
              continue;
            }
            source = source.replace(
              new RegExp(
                `(\\{\\s*(?:${escaped}|['"]${escaped}['"])\\s*:\\s*)['"]${value}['"]`,
                "g",
              ),
              `$1${value}`,
            );
          }
          source = groupDiscriminatorBranches(source, modelName, field);
        }
        if (source !== original) {
          fs.writeFileSync(modelFile, source);
          updatedCount += 1;
        }
      }
      if (!Array.isArray(schema?.allOf)) continue;

      const childModel = getGeneratedModel(modelName);
      if (!childModel) continue;
      const parentSchemas = schema.allOf
        .filter((branch) => typeof branch?.$ref === "string")
        .map((branch) =>
          resolveSchemaRef(branch.$ref, schemaFile, schemaMaps, yaml),
        )
        .filter(Boolean);
      if (parentSchemas.length === 0) continue;

      const inlineBranches = schema.allOf.filter(
        (branch) => branch && typeof branch === "object" && !branch.$ref,
      );
      const requiredChildFields = new Set(
        inlineBranches.flatMap((branch) => branch.required ?? []),
      );
      const childProperties = new Map(
        inlineBranches.flatMap((branch) =>
          Object.entries(branch.properties ?? {}),
        ),
      );
      const additions = new Map();

      for (const parent of parentSchemas) {
        const parentModel = getGeneratedModel(parent.modelName);
        if (!parentModel) continue;
        const parentProperties = parent.schema.properties ?? {};
        const parentRequired = new Set(parent.schema.required ?? []);
        const discriminatorField = parent.schema.discriminator?.propertyName;
        if (
          discriminatorField &&
          typeof schema["x-discriminator-value"] === "string"
        ) {
          additions.set(discriminatorField, {
            name: discriminatorField,
            optional: false,
            type: JSON.stringify(schema["x-discriminator-value"]),
          });
        }

        for (const fieldName of new Set([
          ...requiredChildFields,
          ...childProperties.keys(),
        ])) {
          if (!Object.hasOwn(parentProperties, fieldName)) continue;

          const childProperty = childProperties.get(fieldName);
          const childAllOfBase = childModel.model.bases
            .map(getGeneratedModel)
            .filter((base) => base?.model.properties.has(fieldName))
            .sort(
              (left, right) =>
                Number(right.modelName.endsWith("AllOf")) -
                Number(left.modelName.endsWith("AllOf")),
            )[0];
          const parentProperty = parentModel.model.properties.get(fieldName);
          const childAllOfProperty =
            childAllOfBase?.model.properties.get(fieldName);
          const needsNarrowing = Boolean(
            childProperty &&
            childAllOfProperty &&
            childAllOfProperty.type !== parentProperty?.type,
          );
          // OpenAPI Generator's Axios templates preserve the inline allOf
          // property's optional marker even when another allOf branch
          // requires that same property. Model the intersection explicitly:
          // a field required by either branch remains required on the child.
          const needsRequiredOverride =
            requiredChildFields.has(fieldName) || parentRequired.has(fieldName);
          if (!needsNarrowing && !needsRequiredOverride) continue;

          const typeSource = needsNarrowing
            ? childAllOfBase.modelName
            : parent.modelName;
          const propertyType = `${typeSource}['${fieldName}']`;
          const type = needsRequiredOverride
            ? `Exclude<${propertyType}, undefined>`
            : propertyType;
          additions.set(fieldName, {
            name: fieldName,
            optional:
              !requiredChildFields.has(fieldName) &&
              !parentRequired.has(fieldName),
            type,
          });
        }
      }

      if (
        addOverrides(childModel.file, modelName, childModel.model, [
          ...additions.values(),
        ])
      ) {
        updatedCount += 1;
        generatedSources.delete(modelName);
      }
    }
  }

  process.stdout.write(
    `[contracts] Added source-accurate allOf overrides to ${updatedCount} models.\n`,
  );
}

module.exports = postprocessAllOfOverrides;
