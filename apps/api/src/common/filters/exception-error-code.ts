import { HttpException } from '@nestjs/common';

/**
 * The stable machine-readable code an HttpException publishes. REST error
 * bodies expose it as `code`; GraphQL errors expose it as `extensions.code`.
 */
export function extractHttpExceptionCode(
  exception: HttpException,
): string | undefined {
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const { code } = response as Record<string, unknown>;

  return typeof code === 'string' ? code : undefined;
}
