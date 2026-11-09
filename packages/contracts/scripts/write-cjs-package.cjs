const fs = require("node:fs");
const path = require("node:path");

const packagePath = path.resolve(__dirname, "../dist/cjs/package.json");
fs.writeFileSync(packagePath, '{"type":"commonjs"}\n');
