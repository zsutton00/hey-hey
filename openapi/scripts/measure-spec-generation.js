#!/usr/bin/env node
/*
 * Times spec validation and each consumer's OpenAPI generation, writing output to a scratch
 * directory so no consumer checkout is touched.
 *
 * Usage: node scripts/measure-spec-generation.js [--label before] [--out result.json]
 *        [--jar path/to/openapi-generator-cli.jar] [--runs 1]
 *
 * Each entry mirrors the generator and options a consumer uses (ui-common and cli: typescript-axios;
 * api: typescript-nestjs models; graphs: java and spring; embeddings: python). The jar is shared, so
 * the timings are the generator cost itself, not package-manager overhead.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const spec = (name) => path.join(REPO, 'specs', name, 'openapi.yaml');
const AXIOS = 'supportsES6=true,withInterfaces=true,modelPropertyNaming=camelCase,typescriptThreePlus=true,useSingleRequestParameter=true';

const GENERATIONS = [
  { name: 'ui-common/cli: typescript-axios api', spec: spec('api'), args: ['-g', 'typescript-axios', `--additional-properties=${AXIOS}`, '--global-property=apiDocs=false,modelDocs=false'] },
  { name: 'ui-common/cli: typescript-axios local', spec: spec('local'), args: ['-g', 'typescript-axios', `--additional-properties=${AXIOS}`, '--global-property=apiDocs=false,modelDocs=false'] },
  { name: 'cli: typescript-axios agent-bridge', spec: spec('agent-bridge'), args: ['-g', 'typescript-axios', `--additional-properties=${AXIOS}`, '--global-property=apiDocs=false,modelDocs=false'] },
  { name: 'api: typescript-nestjs api models', spec: spec('api'), args: ['-g', 'typescript-nestjs', '--global-property=models', '--additional-properties=npmName=@hey-hey/api,npmVersion=1.0.0,supportsES6=true,interfaceOnly=true,useObjectParameters=true'] },
  { name: 'api: typescript agent-bridge models', spec: spec('agent-bridge'), args: ['-g', 'typescript', '--global-property=models', '--additional-properties=supportsES6=true,modelPropertyNaming=original,enumPropertyNaming=original'] },
  { name: 'graphs: java api events client', spec: spec('api'), args: ['-g', 'java', '--library', 'resttemplate', '--additional-properties=dateLibrary=java8,useJakartaEe=true,useBeanValidation=true,useOneOfInterfaces=true,containerDefaultToNull=true', '--global-property=apiTests=false,modelTests=false,apiDocs=false,modelDocs=false'] },
  { name: 'graphs: spring graphs api', spec: spec('graphs'), args: ['-g', 'spring', '--library', 'spring-boot', '--additional-properties=dateLibrary=java8,interfaceOnly=true,useSpringBoot3=true,useTags=true,useBeanValidation=true', '--global-property=apiTests=false,modelTests=false,apiDocs=false,modelDocs=false'] },
  { name: 'embeddings: python api events models', spec: spec('api'), args: ['-g', 'python', '--global-property=apiTests=false,modelTests=false,apiDocs=false,modelDocs=false'] },
  { name: 'embeddings: python embeddings api', spec: spec('embeddings'), args: ['-g', 'python', '--global-property=apiTests=false,modelTests=false,apiDocs=false,modelDocs=false'] },
];

function parseArgs(argv) {
  const args = { label: 'run', out: null, jar: null, runs: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--label') args.label = argv[(i += 1)];
    else if (argv[i] === '--out') args.out = argv[(i += 1)];
    else if (argv[i] === '--jar') args.jar = argv[(i += 1)];
    else if (argv[i] === '--runs') args.runs = Number(argv[(i += 1)]);
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}

function timed(command, commandArgs, cwd) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  return { seconds, ok: result.status === 0, tail: result.status === 0 ? '' : `${result.stderr}\n${result.stdout}`.slice(-1500) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const jar = args.jar || path.resolve(REPO, '../api/node_modules/@openapitools/openapi-generator-cli/versions/7.13.0.jar');
  if (!fs.existsSync(jar)) throw new Error(`Generator jar not found at ${jar}; pass --jar.`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-generation-'));
  const results = [];

  const measure = (name, run) => {
    const samples = [];
    let last;
    for (let i = 0; i < args.runs; i += 1) {
      last = run(i);
      samples.push(last.seconds);
    }
    results.push({ name, seconds: Math.min(...samples), samples, ok: last.ok, tail: last.tail });
    process.stderr.write(`${last.ok ? 'ok  ' : 'FAIL'} ${Math.min(...samples).toFixed(1)}s  ${name}\n`);
    if (args.out) fs.writeFileSync(args.out, JSON.stringify({ label: args.label, partial: true, results }, null, 2));
  };

  measure('validate: swagger-cli api', () => timed(path.join(REPO, 'node_modules/.bin/swagger-cli'), ['validate', spec('api')], REPO));
  for (const generation of GENERATIONS) {
    measure(generation.name, (i) => {
      const out = path.join(scratch, `${generation.name.replace(/\W+/g, '-')}-${i}`);
      return timed('java', ['-jar', jar, 'generate', '-i', generation.spec, '-o', out, ...generation.args], REPO);
    });
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  const total = results.reduce((sum, r) => sum + r.seconds, 0);
  const summary = {
    label: args.label,
    measuredAt: new Date().toISOString(),
    specLines: Object.fromEntries(['api', 'agent-bridge', 'local', 'agents', 'embeddings', 'graphs'].map((n) => [n, fs.readFileSync(spec(n), 'utf8').split('\n').length])),
    totalSeconds: total,
    results,
  };
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
  process.stdout.write(`${args.label}: total ${total.toFixed(1)}s across ${results.length} timings\n`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main();
