import { isProductDevelopmentEnvironment } from '../deployment-environment';

/**
 * Tells the CLI whether this deployment is one where Hey Hey itself is
 * developed (staging and local), so it can add environment-gated rules to the
 * shared system prompt. Published on a tool every session lists, so the signal
 * never depends on which optional tools a session holds.
 */
export const PRODUCT_DEVELOPMENT_META_KEY = 'heyhey/productDevelopment';

export const productDevelopmentToolMeta = (): Record<string, boolean> => ({
  [PRODUCT_DEVELOPMENT_META_KEY]: isProductDevelopmentEnvironment(),
});
