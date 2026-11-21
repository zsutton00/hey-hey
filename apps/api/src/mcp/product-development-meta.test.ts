import {
  PRODUCT_DEVELOPMENT_META_KEY,
  productDevelopmentToolMeta,
} from './product-development-meta';

describe('productDevelopmentToolMeta', () => {
  const original = process.env.DEPLOYMENT_ENVIRONMENT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DEPLOYMENT_ENVIRONMENT;
    } else {
      process.env.DEPLOYMENT_ENVIRONMENT = original;
    }
  });

  it.each([
    ['staging', true],
    ['local', true],
    ['production', false],
    ['development', false],
    [undefined, false],
  ])('marks %s as product development: %s', (environment, expected) => {
    if (environment === undefined) {
      delete process.env.DEPLOYMENT_ENVIRONMENT;
    } else {
      process.env.DEPLOYMENT_ENVIRONMENT = environment;
    }

    expect(productDevelopmentToolMeta()).toEqual({
      [PRODUCT_DEVELOPMENT_META_KEY]: expected,
    });
  });
});
