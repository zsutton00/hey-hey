// Generated contract outputs are committed exactly as `pnpm generate:contracts`
// writes them; reformatting them on commit would make every regeneration drift.
const GENERATED = [
  'apps/api/src/generated/',
  'apps/api/src/contracts/repository-feature-enrichment-runtime-schema.ts',
  'apps/api/src/mcp/tools/report-schemas.generated.ts'
];

const isGenerated = (file) =>
  GENERATED.some((prefix) => file.includes(`/${prefix}`));

export default {
  '*.{ts,json,md}': (files) => {
    const handwritten = files.filter((file) => !isGenerated(file));
    return handwritten.length === 0
      ? []
      : `prettier --write --ignore-unknown ${handwritten.map((file) => JSON.stringify(file)).join(' ')}`;
  },
};
