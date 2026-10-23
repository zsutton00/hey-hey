# Scanner API

`FileScanner` builds a lightweight, real-time file index for repository structure discovery.

## Goals

- Fast file listing and repository structure awareness
- Language detection from marker files and file extensions
- Lightweight file classification (`source`, `test`, `config`, `build`, `docs`, `other`)
- Metadata suitable for downstream cache invalidation (`size`, `modifiedTimeMs`, `cacheKey`)

## Usage

```ts
import { FileScanner } from '../scanner/index.js';

const scanner = new FileScanner({
  rootPath: '/repo/path',
  maxDepth: 6,
});

const index = await scanner.refreshIndex();
console.log(index.topLevelDirectories);
console.log(index.repositoryRoots);
console.log(index.candidateEntrypoints);
```

## Shared service (recommended for app code)

Use `ScannerService` to reuse scanner instances, cache indexes per root, and enable watcher-based invalidation.

```ts
import { ScannerService } from '../scanner/index.js';

const scannerService = new ScannerService({ watch: true, maxDepth: 6 });

const index = await scannerService.ensureIndexed('/repo/path');
const files = await scannerService.queryFiles('/repo/path', {
  globPatterns: ['src/**/*.ts'],
});
```

### Query file lists

```ts
const result = scanner.queryFiles({
  languages: ['typescript'],
  classifications: ['source'],
  globPatterns: ['src/**/*.ts'],
  limit: 100,
});

for (const file of result.files) {
  console.log(file.relativePath, file.cacheKey, file.classification, file.language);
}
```

### Language summaries

```ts
const summary = scanner.getLanguageSummary();
console.log(summary.typescript, summary.python);
```

### Candidate entrypoints

The scanner returns likely entrypoints without parsing code (`main.ts`, `main.go`, `__main__.py`, etc.).

```ts
const entrypoints = scanner.getCandidateEntrypoints();
console.log(entrypoints);
```

## Notes

- This module does not parse code or infer architecture.
- `.gitignore` rules are applied during traversal.
- Call `refreshIndex()` when you need up-to-date metadata and cache keys.
