import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'skipTransform';

/**
 * Decorator to disable the `TransformInterceptor` for a specific route handler or controller.
 *
 * Usage:
 * ```ts
 * @SkipTransform()
 * @Get('jwks')
 * async getJwks() { ... }
 * ```
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
