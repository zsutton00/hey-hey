// Assessment only: no fixes, configuration changes, or repository writes.
// Run from any directory: node scripts/assess-type-assertions.cjs [--lint] [--probe]
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const api = path.join(root, "apps/api");
const apiRequire = createRequire(path.join(api, "package.json"));
const ts = apiRequire("typescript");
const { ESLint } = apiRequire("eslint");
const tseslint = apiRequire("typescript-eslint");
const rule = "@typescript-eslint/no-unsafe-type-assertion";
const files = execFileSync("git", ["ls-files", "-z", "apps/api/src"], {
  cwd: root,
})
  .toString()
  .split("\0")
  .filter((f) => /\.tsx?$/.test(f));
// Exclusive, ordered filename buckets; mappings/boundaries are estimates, not semantic labels.
function bucket(file) {
  if (/\/generated\/|\.generated\.ts$|runtime-schema\.ts$/.test(file))
    return "generated";
  if (/\/(__tests__|fixtures|__mocks__)\/|\.(test|spec)\.tsx?$/.test(file))
    return "tests";
  if (
    /mapper|mapping|projector|projection|serializer|presenter|transform|dto/i.test(
      file,
    )
  )
    return "mappings";
  if (
    /controller|adapter|client|gateway|middleware|interceptor|bridge|transport/i.test(
      file,
    )
  )
    return "boundaries";
  return "other";
}
const groups = {};
const perFile = [];
const isAssertion = (n) =>
  ts.isAsExpression(n) || ts.isTypeAssertionExpression(n);
function unparen(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const row = {
    file,
    bucket: bucket(file),
    assertions: 0,
    constAssertions: 0,
    doubleCasts: 0,
    nonNull: 0,
  };
  function visit(node) {
    if (isAssertion(node)) {
      if (node.type.getText(source) === "const") row.constAssertions++;
      else row.assertions++;
      if (isAssertion(unparen(node.expression))) row.doubleCasts++;
    }
    if (ts.isNonNullExpression(node)) row.nonNull++;
    ts.forEachChild(node, visit);
  }
  visit(source);
  perFile.push(row);
  const group = (groups[row.bucket] ??= {
    files: 0,
    filesWithAssertions: 0,
    assertions: 0,
    constAssertions: 0,
    doubleCasts: 0,
    nonNull: 0,
  });
  group.files++;
  if (row.assertions) group.filesWithAssertions++;
  for (const key of ["assertions", "constAssertions", "doubleCasts", "nonNull"])
    group[key] += row[key];
}
const output = {
  scope:
    "Git-tracked apps/api/src TypeScript files; working-tree contents; declarations included",
  versions: {
    typescript: ts.version,
    typescriptEslint: apiRequire("typescript-eslint/package.json").version,
  },
  definitions:
    "assertions excludes as const; doubleCasts counts adjacent nested assertion pairs, also included in assertions; nonNull is expression ! only; buckets are filename heuristics",
  groups,
  perFile,
};
async function main() {
  const languageOptions = {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: api },
  };
  if (process.argv.includes("--lint")) {
    const lint = new ESLint({
      cwd: api,
      overrideConfigFile: true,
      allowInlineConfig: false,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions,
          plugins: { "@typescript-eslint": tseslint.plugin },
          rules: { [rule]: "error" },
        },
      ],
    });
    const targets = perFile
      .filter((f) => f.bucket !== "generated")
      .map((f) => path.join(root, f.file));
    const results = await lint.lintFiles(targets);
    output.lint = {
      rule,
      scope:
        "All non-generated census files; inline disables ignored; only candidate rule enabled",
      groups: {},
      findings: [],
      failures: [],
    };
    for (const result of results) {
      const file = path.relative(root, result.filePath);
      for (const message of result.messages) {
        const entry = {
          file,
          line: message.line,
          column: message.column,
          message: message.message,
        };
        if (message.ruleId !== rule) output.lint.failures.push(entry);
        else {
          output.lint.findings.push(entry);
          const group = (output.lint.groups[bucket(file)] ??= {
            findings: 0,
            files: [],
          });
          group.findings++;
          if (!group.files.includes(file)) group.files.push(file);
        }
      }
    }
  }
  if (process.argv.includes("--probe")) {
    const probePath = path.join(api, "src/assertion-assessment.probe.ts");
    const source = `import type { ProjectedWorkItem } from './generated/model/projectedWorkItem';
declare const task: { tag: string | null };
declare const valid: NonNullable<ProjectedWorkItem['tag']>;
export const direct = task.tag as ProjectedWorkItem['tag'];
export const doubleUnknown = task.tag as unknown as ProjectedWorkItem['tag'];
export const doubleAny = task.tag as any as ProjectedWorkItem['tag'];
export const validAssignment: ProjectedWorkItem['tag'] = valid;
export const validSatisfies = { tag: valid } satisfies Pick<ProjectedWorkItem, 'tag'>;
export const validWidening = valid as string;
export const literal = { tag: 'product' } as const;
export const normalizedButNarrowed = (task.tag ?? undefined) as ProjectedWorkItem['tag'];
export const nonNullEscape = task.tag!;
export const invalidAssignment: ProjectedWorkItem['tag'] = task.tag;
declare const typedTask: { tag: NonNullable<ProjectedWorkItem['tag']> | null };
export const validNormalized = { tag: typedTask.tag ?? undefined } satisfies Pick<ProjectedWorkItem, 'tag'>;
export const angleAssertion = <ProjectedWorkItem['tag']>task.tag;
`;
    const config = ts.readConfigFile(
      path.join(api, "tsconfig.json"),
      ts.sys.readFile,
    ).config;
    const { options } = ts.parseJsonConfigFileContent(config, ts.sys, api);
    const host = ts.createCompilerHost(options);
    const originalGet = host.getSourceFile.bind(host);
    host.getSourceFile = (name, version, ...rest) =>
      name === probePath
        ? ts.createSourceFile(name, source, version, true)
        : originalGet(name, version, ...rest);
    const program = ts.createProgram(
      [probePath],
      { ...options, incremental: false, noEmit: true },
      host,
    );
    const parserOptions = {
      projectService: false,
      programs: [program],
      tsconfigRootDir: api,
    };
    const probeRules = [
      rule,
      "@typescript-eslint/no-unnecessary-type-assertion",
      "@typescript-eslint/consistent-type-assertions",
      "@typescript-eslint/no-non-null-assertion",
    ];
    output.probe = { source, rules: {}, typeErrors: [] };
    for (const name of probeRules) {
      const lint = new ESLint({
        cwd: api,
        overrideConfigFile: true,
        overrideConfig: [
          {
            files: ["**/*.ts"],
            languageOptions: { parser: tseslint.parser, parserOptions },
            plugins: { "@typescript-eslint": tseslint.plugin },
            rules: {
              [name]: name.endsWith("/consistent-type-assertions")
                ? ["error", { assertionStyle: "never" }]
                : "error",
            },
          },
        ],
      });
      const [result] = await lint.lintText(source, { filePath: probePath });
      output.probe.rules[name] = result.messages.map(
        ({ line, message, ruleId }) => ({ line, message, ruleId }),
      );
    }
    const current = new ESLint({
      cwd: api,
      overrideConfig: [{ languageOptions: { parserOptions } }],
    });
    const [baseline] = await current.lintText(source, { filePath: probePath });
    output.probe.currentAssertionDiagnostics = baseline.messages.filter((m) =>
      /assertion/.test(m.ruleId ?? ""),
    );
    output.probe.typeErrors = program
      .getSemanticDiagnostics(program.getSourceFile(probePath))
      .map((d) => ({
        line: ts.getLineAndCharacterOfPosition(d.file, d.start).line + 1,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      }));
    assert.deepEqual(
      output.probe.rules[rule].map((m) => m.line),
      [4, 5, 6, 6, 11, 16],
    );
    assert.deepEqual(
      output.probe.rules["@typescript-eslint/no-unnecessary-type-assertion"],
      [],
    );
    assert.deepEqual(
      output.probe.rules["@typescript-eslint/no-non-null-assertion"].map(
        (m) => m.line,
      ),
      [12],
    );
    assert.equal(output.probe.currentAssertionDiagnostics.length, 0);
    assert.deepEqual(
      output.probe.typeErrors.map((m) => m.line),
      [13],
    );
    output.probe.expectationChecks = "passed";
  }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
