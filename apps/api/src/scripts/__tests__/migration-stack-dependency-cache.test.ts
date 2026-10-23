import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';

const root = resolve(__dirname, '../../..');
const dockerfile = readFileSync(
  join(root, 'docker/migration-stack/embeddings.Dockerfile'),
  'utf8',
);

describe('migration stack dependency cache', () => {
  it.each([0, 1])(
    'builds the INT8 artifact and propagates builder exit %s',
    (exitCode) => {
      const temp = mkdtempSync(join(tmpdir(), 'migration-int8-'));
      try {
        mkdirSync(join(temp, 'scripts'));
        writeFileSync(
          join(temp, 'scripts/build_jina_int8.py'),
          `import argparse, pathlib, sys
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--cache', required=True)
args = parser.parse_args()
cache = pathlib.Path(args.cache)
cache.mkdir(parents=True)
sys.exit(${exitCode}) if ${exitCode} else None
output = pathlib.Path(args.output)
output.mkdir(parents=True)
(output / 'manifest.json').write_text('verified')
`,
        );
        const build = dockerfile
          .split('RUN python scripts/build_jina_int8.py')[1]!
          .split('\n\n')[0]!;
        const result = spawnSync(
          'sh',
          [
            '-c',
            `python3 scripts/build_jina_int8.py${build}`
              .replaceAll(
                '/app/models/jina-colbert-v2-int8',
                join(temp, 'model'),
              )
              .replaceAll('/tmp/jina-build-cache', join(temp, 'cache')),
          ],
          { cwd: temp },
        );
        expect(result.status).toBe(exitCode);
        if (exitCode === 0) {
          expect(readFileSync(join(temp, 'model/manifest.json'), 'utf8')).toBe(
            'verified',
          );
          expect(spawnSync('test', ['-e', join(temp, 'cache')]).status).toBe(1);
        }
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    },
  );

  it.each([
    '<tuning><resource-limits><disk>0.90</disk><memory>0.75</memory></resource-limits></tuning>',
    '',
  ])(
    'overrides only the dev disk limit in the selected Vespa application: %s',
    (tuning) => {
      const temp = mkdtempSync(join(tmpdir(), 'migration-vespa-'));
      try {
        mkdirSync(join(temp, 'vespa-app'));
        writeFileSync(
          join(temp, 'vespa-app/services.xml'),
          `<services><content id="embeddings">${tuning}<engine><proton><resource-limits><memory>0.85</memory></resource-limits></proton></engine><documents><document type="task" mode="index" /></documents></content></services>`,
        );
        const override = dockerfile
          .split("RUN python - <<'VESPA_DEV'\n")[1]!
          .split('\nVESPA_DEV')[0]!;
        execFileSync('python3', ['-c', override], { cwd: temp });
        execFileSync(
          'python3',
          [
            '-c',
            `
import xml.etree.ElementTree as ET
root = ET.parse("vespa-app/services.xml").getroot()
content = root.find("content[@id='embeddings']")
assert content.find("tuning/resource-limits/disk").text == "1.0"
assert content.find("engine/proton/resource-limits/disk").text == "1.0"
assert content.find("engine/proton/resource-limits/memory").text == "0.85"
memory = content.find("tuning/resource-limits/memory")
assert (memory.text if memory is not None else None) == ${tuning ? '"0.75"' : 'None'}
assert content.find("documents/document").attrib == {"type": "task", "mode": "index"}
`,
          ],
          { cwd: temp },
        );
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    },
  );

  it('keeps Graph contracts and source out of Maven dependency resolution', () => {
    const graph = readFileSync(
      join(root, 'docker/migration-stack/graph.Dockerfile'),
      'utf8',
    );
    const [base, build] = graph.split('FROM dependencies AS build');
    expect(base).toContain('COPY --from=graph /pom.xml ./pom.xml');
    expect(base).toContain('mvn dependency:go-offline');
    expect(base).not.toContain('COPY --from=openapi');
    expect(base).not.toContain('COPY --from=graph /scripts');
    expect(base).not.toContain('COPY --from=graph /src');
    expect(build).toContain('COPY --from=openapi /specs /openapi/specs');
    expect(build).toContain('COPY --from=graph /scripts ./scripts');
    expect(build).toContain('COPY --from=graph /src ./src');
    expect(build).toContain('mvn clean package');
    // Both Maven invocations must use the same persistent repository.
    const cache =
      '--mount=type=cache,id=heyhey-migration-maven,target=/root/.m2,sharing=locked';
    expect(base).toContain(cache);
    expect(build).toContain(cache);
  });

  it('separates generated installs while retaining the external dependency contract', () => {
    const temp = mkdtempSync(join(tmpdir(), 'migration-dependencies-'));
    try {
      const external = '# ML dependencies\npylate==1.6.0\n\n';
      const generated =
        '-e generated/openapi-models\n-e generated/openapi-events-models\n';
      writeFileSync(join(temp, 'requirements.txt'), external + generated);
      const split = dockerfile
        .split("RUN python - <<'PY'\n")[1]!
        .split('\nPY')[0]!;
      execFileSync('python3', ['-c', split], { cwd: temp });
      expect(
        readFileSync(join(temp, 'requirements-external.txt'), 'utf8'),
      ).toBe(external);
      expect(
        readFileSync(join(temp, 'requirements-generated.txt'), 'utf8'),
      ).toBe(generated);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('keeps generated contracts and current source out of the dependency base', () => {
    const [base, runtime] = dockerfile.split('FROM dependencies AS runtime');
    expect(base).toContain('AS dependencies');
    expect(base).toContain('/requirements.txt /constraints.txt');
    expect(base).toContain('--requirement requirements-external.txt');
    expect(base).not.toContain('COPY --from=embeddings /generated/');
    expect(base).not.toContain('COPY --from=embeddings / ./');
    expect(runtime).toContain('COPY --from=embeddings /generated/');
    expect(runtime).toContain(
      '--constraint constraints.txt --requirement requirements-generated.txt',
    );
    expect(runtime).toContain('COPY --from=embeddings / ./');
  });

  it('wires the selected embeddings checkout into the migration Dockerfile', () => {
    const compose = load(
      readFileSync(join(root, 'docker-compose.migration-stack.yml'), 'utf8'),
    ) as {
      services: Record<string, { build: unknown }>;
    };
    expect(compose.services['vespa-app-sync']!.build).toMatchObject({
      context: '${API_ROOT}',
      dockerfile: 'docker/migration-stack/embeddings.Dockerfile',
      additional_contexts: { embeddings: '${EMBEDDINGS_ROOT}' },
    });
  });
});
