// Reads the shared entity prompt-template parser so each language generator
// can embed it verbatim in its generated output.
const fs = require("node:fs");
const path = require("node:path");

module.exports = fs.readFileSync(
  path.join(__dirname, "entity-prompt-template-parser.ts"),
  "utf8",
);
