const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");
const { isDeepStrictEqual } = require("node:util");
const {
  CONTROLLER_ROOT_DEFINITIONS,
} = require("./generate-controller-action-contract");

// Development-only: examine every schema reachable from the same roots used
// by the generated controller validator. No launch-variant fixture list.
function checkComposition(document, roots) {
  const problems = new Set();
  const visited = new Set();
  const resolve = (ref) => {
    if (!ref.startsWith("#/"))
      throw new Error(`Unbundled schema reference: ${ref}`);
    return ref
      .slice(2)
      .split("/")
      .reduce(
        (value, key) => value[key.replace(/~1/g, "/").replace(/~0/g, "~")],
        document,
      );
  };
  const follow = (schema) =>
    schema?.$ref ? follow(resolve(schema.$ref)) : schema;
  const expanded = new Map();
  const expand = (value) => {
    value = follow(value);
    if (!value || typeof value !== "object") return value;
    if (expanded.has(value)) return expanded.get(value);
    const result = Array.isArray(value) ? [] : {};
    expanded.set(value, result);
    for (const [key, child] of Object.entries(value))
      result[key] = expand(child);
    return result;
  };
  const conjuncts = (schema, location, seen = new Set()) => {
    if (!schema || typeof schema !== "object" || seen.has(schema)) return [];
    seen.add(schema);
    if (schema.$ref) return conjuncts(resolve(schema.$ref), schema.$ref, seen);
    return [
      { schema, location },
      ...(schema.allOf ?? []).flatMap((arm, index) =>
        conjuncts(arm, `${location}/allOf/${index}`, seen),
      ),
    ];
  };
  const visit = (schema, location) => {
    if (!schema || typeof schema !== "object" || visited.has(schema)) return;
    visited.add(schema);
    if (schema.$ref) visit(resolve(schema.$ref), schema.$ref);
    // Flat closed envelopes cite their body schema rather than intersecting a
    // closed object. Require every body field/requirement as that schema evolves.
    const bodyRef = schema["x-heyhey-prompt-payload"]?.$ref;
    if (bodyRef) {
      const body = resolve(bodyRef);
      const bodyFields = new Set(Object.keys(body.properties));
      for (const field of Object.keys(schema.properties ?? {})) {
        if (
          field !== "promptType" &&
          field !== "entity" &&
          !bodyFields.has(field)
        ) {
          problems.add(
            `${location}: stale body field '${field}' is absent from ${bodyRef}`,
          );
        }
      }
      for (const field of Object.keys(body.properties)) {
        if (
          !isDeepStrictEqual(
            expand(schema.properties?.[field]),
            expand(body.properties[field]),
          )
        ) {
          problems.add(
            `${location}: field '${field}' must match ${bodyRef}/properties/${field}`,
          );
        }
      }
      for (const field of body.required ?? []) {
        if (!schema.required?.includes(field))
          problems.add(
            `${location}: must require body field '${field}' from ${bodyRef}`,
          );
      }
      for (const field of schema.required ?? []) {
        if (bodyFields.has(field) && !body.required?.includes(field)) {
          problems.add(
            `${location}: optional body field '${field}' must remain optional as in ${bodyRef}`,
          );
        }
      }
    }
    if (schema.allOf || schema.additionalProperties === false) {
      const arms = conjuncts(schema, location);
      const fields = new Set(
        arms.flatMap(({ schema: arm }) => [
          ...Object.keys(arm.properties ?? {}),
          ...(arm.required ?? []),
        ]),
      );
      for (const { schema: arm, location: closedAt } of arms) {
        if (arm.additionalProperties !== false) continue;
        for (const field of fields) {
          const allowed =
            Object.hasOwn(arm.properties ?? {}, field) ||
            Object.keys(arm.patternProperties ?? {}).some((pattern) =>
              new RegExp(pattern).test(field),
            );
          if (!allowed)
            problems.add(
              `${location}: field '${field}' is composed with ${closedAt}, whose additionalProperties:false forbids it`,
            );
        }
      }
    }
    for (const [key, value] of Object.entries(schema)) {
      if (key !== "$ref") visit(value, `${location}/${key}`);
    }
  };
  for (const root of roots) {
    const ref = `#/components/schemas/${root}`;
    const schema = resolve(ref);
    if (!schema) throw new Error(`Missing controller schema: ${root}`);
    visit(schema, ref);
  }
  return [...problems];
}

async function checkControllerSchemaComposition() {
  const document = await SwaggerParser.bundle(
    path.join(__dirname, "../specs/agent-bridge/openapi.yaml"),
  );
  const problems = checkComposition(document, CONTROLLER_ROOT_DEFINITIONS);
  if (problems.length)
    throw new Error(
      `Controller schema composition failed:\n${problems.join("\n")}`,
    );
}

if (require.main === module) {
  checkControllerSchemaComposition().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { checkComposition, checkControllerSchemaComposition };
