// Bundles the CLI into a single dist/index.mjs with esbuild.
//
// esbuild handles the whole job in one pass: the .tsx entry, the inlined
// await import() command modules, CJS-to-ESM interop, Node-platform builtins,
// hashbang preservation, and node20 targeting.
//
// The bundle is ESM because Ink and its yoga-layout engine use top-level
// await, which CJS output cannot express.
//
// Run `node scripts/build.mjs` for a one-off build, or with `--watch` to
// rebuild on change (used by the dev:build script).
import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(cliRoot, 'dist/index.mjs');

// Externalize every Node builtin in both bare and node:-prefixed form.
// platform: 'node' covers most, but not bare subpath specifiers such as
// "readline/promises" — listing builtinModules explicitly closes that gap.
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

// Ink loads react-devtools-core only when DEV=true. It is an optional peer
// that is not installed, so the bundle gets an inert stand-in.
const omitReactDevtools = {
  name: 'omit-react-devtools',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'omit-react-devtools',
    }));
    build.onLoad({ filter: /.*/, namespace: 'omit-react-devtools' }, () => ({
      contents: 'export default { initialize() {}, connectToDevTools() {} };',
      loader: 'js',
    }));
  },
};

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [path.join(cliRoot, 'src/index.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Single outfile, no code-splitting: the entry's await import() command
  // modules are inlined into this one file.
  outfile,
  sourcemap: false,
  // Bake in production React. Without this, React selects its development
  // build at runtime and records a PerformanceMeasure on every commit, which
  // Node retains indefinitely and grows the heap without bound.
  define: { 'process.env.NODE_ENV': '"production"' },
  // CLI sources and bundled CJS dependencies use require, __filename and
  // __dirname, which ESM does not define. Recreate them for the bundle's own
  // file so module resolution still walks up node_modules from there.
  banner: {
    js: [
      "import { createRequire as __heyheyCreateRequire } from 'node:module';",
      "import { fileURLToPath as __heyheyFileURLToPath } from 'node:url';",
      "import { dirname as __heyheyDirname } from 'node:path';",
      'const require = __heyheyCreateRequire(import.meta.url);',
      'const __filename = __heyheyFileURLToPath(import.meta.url);',
      'const __dirname = __heyheyDirname(__filename);',
    ].join('\n'),
  },
  // @napi-rs/keyring ships a prebuilt native .node addon that cannot be
  // bundled; it stays external and resolves from node_modules at runtime.
  // playwright-core resolves its own assets relative to its install directory
  // at runtime, so it stays external like the keyring addon.
  external: ['@napi-rs/keyring', 'playwright-core', ...nodeBuiltins],
  plugins: [omitReactDevtools],
  logLevel: 'info',
};

const watch = process.argv.includes('--watch');

// Source maps are not published. Remove one left by an older build so the
// package's `dist` allowlist cannot include a stale map. The CJS bundle that
// preceded the ESM one is removed for the same reason.
await rm(`${outfile}.map`, { force: true });
await rm(path.join(cliRoot, 'dist/index.js'), { force: true });
await rm(path.join(cliRoot, 'dist/index.js.map'), { force: true });

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('esbuild: watching src/index.tsx for changes...');
} else {
  await esbuild.build(buildOptions);
}
