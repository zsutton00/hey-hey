const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const fail = () => {
  console.error(
    "OpenAPI generation must run through pnpm generate:contracts so outputs stay private until publication.",
  );
  process.exitCode = 1;
};

const stagingRoot = process.env.HEY_HEY_OPENAPI_STAGING_ROOT;
const token = process.env.HEY_HEY_OPENAPI_LOCK_TOKEN;
if (process.env.HEY_HEY_OPENAPI_STAGING !== "1" || !stagingRoot || !token) {
  fail();
} else {
  const resolvedStagingRoot = path.resolve(stagingRoot);
  const relativeCwd = path.relative(
    resolvedStagingRoot,
    path.resolve(process.cwd()),
  );
  const isStagedCwd =
    relativeCwd === "" ||
    (!relativeCwd.startsWith(`..${path.sep}`) &&
      relativeCwd !== ".." &&
      !path.isAbsolute(relativeCwd));
  const ownerPath = path.join(
    os.tmpdir(),
    "hey-hey-openapi-generation.lock",
    "owner.json",
  );

  let ownerToken;
  try {
    ownerToken = JSON.parse(fs.readFileSync(ownerPath, "utf8")).token;
  } catch {
    fail();
  }

  if (!isStagedCwd || ownerToken !== token) {
    fail();
  }
}
