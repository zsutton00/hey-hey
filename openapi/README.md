# Hey Hey OpenAPI Specifications

Canonical OpenAPI specifications for the Hey Hey platform. No generated SDKs or bundled specs are committed—each consumer should generate their own artifacts locally using the scripts in this repo.

## What's Inside
- `specs/` – Primary OpenAPI sources (core API, embeddings, agents, graphs, and the transport-neutral Agent Bridge runtime contract)
- `clients/` – Aggregated OpenAPI entries for web, mobile, and internal clients
- `scripts/` – Helper scripts for validation and codegen
- `docs/` – HTML documentation output (generated locally)
- `generated/` – Bundled specs and SDKs (gitignored; produced locally when you run codegen)

## Quick Start
```bash
npm install

# Validate specs
npm run validate

# Bundle specs (outputs to ./generated/)
npm run bundle:api
npm run bundle:embeddings

# Generate SDKs locally (outputs to ./generated/clients/)
npm run generate:typescript
npm run generate:python

# Generate HTML docs locally (outputs to ./docs/)
npm run docs
```

Notes:
- `generated/` and `docs/` are build artifacts only—they are intentionally not checked in.
- Point your OpenAPI tooling at `specs/api/openapi.yaml`, `specs/embeddings/openapi.yaml`, `specs/agents/openapi.yaml`, or `specs/agent-bridge/openapi.yaml` for the source specs.

## Validation
- `npm run validate` – Run duplicate detection and validate all specs
- `npm run check-duplicates` – Check for `operationId` conflicts
- `npm run watch` – Validate on file changes during editing

## Regenerating Artifacts
- TypeScript SDKs: `npm run generate:typescript`
- Python SDKs: `npm run generate:python`
- Bundled specs only: `npm run bundle:api` and `npm run bundle:embeddings`
- Docs: `npm run docs`

Regeneration is fast and isolated—run whichever commands you need in your own working copy. Downstream consumers should always generate their own clients from the specs rather than relying on committed artifacts.
