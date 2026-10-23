const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const resolveGeneratedRoot = () =>
  process.env.HEY_HEY_GENERATED_ROOT
    ? path.resolve(process.env.HEY_HEY_GENERATED_ROOT)
    : path.join(PROJECT_ROOT, 'src', 'generated');

module.exports = { resolveGeneratedRoot };
