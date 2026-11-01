module.exports = async () => {
  global.__jestModelGenerationLock.release();
  delete global.__jestModelGenerationLock;
};
