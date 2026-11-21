export const extractErrorMessage = (error: unknown): string | undefined => {
  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    if ("response" in error) {
      const nestedMessage = (
        error as { response?: { data?: { message?: unknown } } }
      ).response?.data?.message;

      if (typeof nestedMessage === "string") {
        return nestedMessage;
      }
    }

    const directMessage = (error as { message?: unknown }).message;
    if (typeof directMessage === "string") {
      return directMessage;
    }
  }

  return undefined;
};

export const getErrorMessage = (error: unknown, fallback: string): string => {
  return extractErrorMessage(error) ?? fallback;
};

interface ErrorCodeCarrier {
  extensions?: { code?: unknown };
  errors?: ReadonlyArray<ErrorCodeCarrier>;
  response?: { data?: { code?: unknown } };
}

const asNonEmptyCode = (code: unknown): string | undefined => {
  return typeof code === "string" && code.length > 0 ? code : undefined;
};

/**
 * Pulls the structured `code` discriminator out of a failed request. Platform
 * endpoints return error envelopes such as
 * `{ success: false, code: 'NO_CLI_CONNECTION', message, statusCode }`
 * (`error.response.data.code`), and GraphQL reads carry the same code in
 * `extensions.code`, either on the error itself or on the first of a combined
 * error's `errors`. The `code` is the stable key to branch on, whereas the
 * human-readable `message` may change. Returns `undefined` when the error
 * carries no structured code.
 */
export const extractErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const carrier = error as ErrorCodeCarrier;

  return (
    asNonEmptyCode(carrier.response?.data?.code) ??
    asNonEmptyCode(carrier.extensions?.code) ??
    asNonEmptyCode(carrier.errors?.[0]?.extensions?.code)
  );
};
