import path from "node:path";
import type { CodegenConfig } from "@graphql-codegen/cli";

const openapiRoot = process.env.HEY_HEY_OPENAPI_ROOT;
if (!openapiRoot) {
  throw new Error(
    "HEY_HEY_OPENAPI_ROOT is not set; run GraphQL codegen through pnpm generate:contracts.",
  );
}

const config: CodegenConfig = {
  schema: path.join(openapiRoot, "specs/graphql/web-ui-read.graphql"),
  documents: ["src/data/graphql/**/*.graphql"],
  generates: {
    "src/graphql/generated/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: { useTypeImports: true },
    },
  },
};

export default config;
