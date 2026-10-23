const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const root = require("child_process")
  .execFileSync(process.execPath, [path.join(__dirname, "openapi-root.cjs")], {
    encoding: "utf8",
  })
  .trim();

function resolve(schema, file) {
  if (Array.isArray(schema)) return schema.map((value) => resolve(value, file));
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    const [relative, fragment] = schema.$ref.split("#/");
    const target = relative ? path.resolve(path.dirname(file), relative) : file;
    const document = yaml.load(fs.readFileSync(target, "utf8"));
    return resolve(
      fragment.split("/").reduce((value, key) => value[key], document),
      target,
    );
  }
  const result = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== "nullable" && key !== "discriminator")
      .map(([key, value]) => [key, resolve(value, file)]),
  );
  return schema.nullable ? { anyOf: [result, { type: "null" }] } : result;
}
const source = path.join(root, "specs/schemas/open-items.yaml");
const document = yaml.load(fs.readFileSync(source, "utf8"));
fs.writeFileSync(
  "src/generated/open-items-contract.ts",
  "// Generated from OpenAPI by scripts/generate-open-items-contract.cjs.\nexport const openItemsSchemas = " +
    JSON.stringify(
      Object.fromEntries(
        Object.entries(document).map(([name, schema]) => [
          name,
          resolve(schema, source),
        ]),
      ),
      null,
      2,
    ) +
    " as const;\n",
);
