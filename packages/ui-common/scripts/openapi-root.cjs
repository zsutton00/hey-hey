const fs = require("fs");
const path = require("path");

const workingDirectory = process.cwd();
const worktreeName = path.basename(workingDirectory);
const candidates = [
  process.env.HEY_HEY_OPENAPI_ROOT,
  path.resolve(
    workingDirectory,
    "../../../openapi/.worktrees",
    worktreeName,
  ),
  path.resolve(workingDirectory, "../openapi"),
].filter(Boolean);

const openapiRoot = candidates.find((candidate) =>
  fs.existsSync(path.join(candidate, "specs/api/openapi.yaml")),
);

if (!openapiRoot) {
  throw new Error(
    "Unable to locate the OpenAPI repository. Set HEY_HEY_OPENAPI_ROOT to the pinned checkout.",
  );
}

process.stdout.write(fs.realpathSync(openapiRoot));
