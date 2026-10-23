#!/bin/bash

# Generate All Client SDKs and Documentation
# This script validates OpenAPI specs and generates clients for all services

set -e

echo "🔍 Validating OpenAPI specifications..."
npm run validate

echo "📦 Bundling specifications..."
npm run bundle:embeddings
npm run bundle:api

echo "🏗️  Generating TypeScript clients..."
npm run generate:typescript

echo "🐍 Generating Python clients..."
npm run generate:python

echo "📚 Generating documentation..."
npm run docs

echo "✅ All code generation completed successfully!"
echo ""
echo "Generated artifacts:"
echo "  - TypeScript clients: ./generated/clients/typescript/"
echo "  - Python clients: ./generated/clients/python/"
echo "  - Documentation: ./docs/"
echo "  - Bundled specs: ./generated/"
echo ""
echo "Reminder: generated/ and docs/ are gitignored; keep these outputs local to your workspace."
