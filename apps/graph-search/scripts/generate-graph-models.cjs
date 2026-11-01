const fs = require("fs"),
  path = require("path"),
  YAML = require("yaml");
process.chdir(path.resolve(__dirname, "../../.."));
const source = path.resolve("openapi/specs/graphs/openapi.yaml");
const cache = new Map();
function doc(file) {
  if (!cache.has(file)) {
    cache.set(file, YAML.parse(fs.readFileSync(file, "utf8")));
  }
  return cache.get(file);
}
function resolve(s, file) {
  while (s.$ref) {
    const [p, fragment] = s.$ref.split("#");
    file = p ? path.resolve(path.dirname(file), p) : file;
    s = fragment
      .slice(1)
      .split("/")
      .reduce((v, k) => v[k], doc(file));
  }
  return [s, file];
}
const names = [
  "SearchRequest",
  "EntityNeighborhoodRequest",
  "IncidentEdgesRequest",
  "BatchRelationshipRequest",
  "FeatureProjectConnectionRequest",
];
let output =
  "// Generated from openapi/specs/graphs/openapi.yaml. Do not edit.\nuse serde::{Deserialize, Serialize};\n";
const done = new Set();
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
function ty(s, file, name) {
  if (s.$ref) {
    const n = s.$ref.split("/").pop();
    let [r, f] = resolve(s, file);
    if (r.type === "object") {
      emit(n, r, f);
      return n;
    }
    return ty(r, f, n);
  }
  if (s.type === "array") {
    return `Vec<${ty(s.items, file, name + "Item")}>`;
  }
  if (s.type === "object" && s.properties) {
    emit(name, s, file);
    return name;
  }
  return (
    {
      string: "String",
      integer: "i64",
      number: "f64",
      boolean: "bool",
      object: "serde_json::Value",
    }[s.type] || "serde_json::Value"
  );
}
function emit(name, s, file) {
  if (done.has(name)) {
    return;
  }
  done.add(name);
  let body = "";
  for (const [key, p] of Object.entries(s.properties || {})) {
    const t = ty(p, file, name + key[0].toUpperCase() + key.slice(1));
    const required = (s.required || []).includes(key);
    body += `    #[serde(rename = ${JSON.stringify(key)}${required ? "" : ', default, skip_serializing_if = "Option::is_none"'})]\n    pub ${key === "type" ? "kind" : snake(key)}: ${required ? t : `Option<${t}>`},\n`;
  }
  output += `#[derive(Clone, Debug, Default, Deserialize, Serialize)]\n${s.additionalProperties === false ? "#[serde(deny_unknown_fields)]\n" : ""}pub struct ${name} {\n${body}}\n`;
}
for (const name of names) {
  emit(name, doc(source).components.schemas[name], source);
}

function schema(s, file) {
  [s, file] = resolve(s, file);
  const result = {};
  for (const key of [
    "type",
    "enum",
    "required",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "additionalProperties",
    "format",
  ]) {
    if (s[key] !== undefined) {
      result[key] = s[key];
    }
  }
  if (s.properties) {
    result.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, schema(v, file)]),
    );
  }
  if (s.items) {
    result.items = schema(s.items, file);
  }
  return result;
}
const schemas = Object.fromEntries(
  names.map((n) => [n, schema(doc(source).components.schemas[n], source)]),
);
output += `pub const REQUEST_SCHEMAS: &str = r###"${JSON.stringify(schemas)}"###;\n`;
const entityTypes = resolve(
  doc(source).components.schemas.EntityType,
  source,
)[0].enum;
output += `pub const ENTITY_TYPES: &[&str] = &${JSON.stringify(entityTypes)};\n`;
const formatted = require("child_process").spawnSync(
  "rustfmt",
  ["--edition", "2024"],
  { input: output, encoding: "utf8" },
);
if (formatted.status !== 0) {
  throw new Error(formatted.stderr);
}
const destination = "apps/graph-search/src/graph/generated/mod.rs";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(destination, "utf8") !== formatted.stdout) {
    throw new Error(
      "Graph models are stale; run pnpm generate:graph-contracts",
    );
  }
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, formatted.stdout);
}
