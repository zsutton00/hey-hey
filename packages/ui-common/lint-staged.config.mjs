// Generated contract outputs are committed exactly as `pnpm generate:contracts`
// writes them; reformatting them on commit would make every regeneration drift.
const GENERATED = [
  "packages/ui-common/src/api/",
  "packages/ui-common/src/generated/",
  "packages/ui-common/src/local-agent-api/generated/",
  "packages/ui-common/src/clients/private-beta-access-contract.generated.ts",
];

const isGenerated = (file) =>
  GENERATED.some((prefix) => file.includes(`/${prefix}`));

export default {
  "*.{ts,tsx,js,jsx,mjs,cjs,json,css,md,yml,yaml}": (files) => {
    const handwritten = files.filter((file) => !isGenerated(file));
    return handwritten.length === 0
      ? []
      : `prettier --write --ignore-unknown ${handwritten.map((file) => JSON.stringify(file)).join(" ")}`;
  },
};
