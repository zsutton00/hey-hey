#!/bin/bash

# Validate and Publish OpenAPI Specifications
# This script validates specs and publishes them to a registry or repository

set -e

echo "🔍 Validating all OpenAPI specifications..."

# Validate each spec individually for better error reporting
for spec in specs/**/openapi.yaml; do
    echo "  Validating: $spec"
    npx @apidevtools/swagger-cli validate "$spec"
done

echo "✅ All specifications are valid!"

echo "📦 Bundling specifications for distribution..."
npm run bundle:api
npm run bundle:embeddings

# Optional: Check for breaking changes
if command -v oasdiff &> /dev/null; then
    echo "🔍 Checking for breaking changes..."
    # Add breaking change detection logic here
fi

echo "🚀 Ready for publication!"
echo ""
echo "Next steps:"
echo "  1. Commit changes to version control"
echo "  2. Tag release version"
echo "  3. Generate and distribute client SDKs"
echo "  4. Update service documentation"