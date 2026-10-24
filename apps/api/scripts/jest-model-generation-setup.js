const { acquireModelGenerationLock } = require('./model-generation-lock');

module.exports = async () => {
  // Keep generated sources stable throughout Jest's module loading and execution.
  // Do not pass the token to workers: generation launched by a test must wait too.
  global.__jestModelGenerationLock = await acquireModelGenerationLock({
    output: (message) => console.error(message),
  });
};
