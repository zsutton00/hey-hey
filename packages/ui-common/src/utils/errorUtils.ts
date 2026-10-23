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

/**
 * Pulls the structured `code` discriminator out of a server error body
 * (`error.response.data.code`). Platform endpoints return error envelopes such
 * as `{ success: false, code: 'NO_CLI_CONNECTION', message, statusCode }`; the
 * `code` is the stable key to branch on, whereas the human-readable `message`
 * may change. Returns `undefined` when the error carries no structured code.
 */
export const extractErrorCode = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "response" in error) {
    const code = (error as { response?: { data?: { code?: unknown } } })
      .response?.data?.code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  return undefined;
};
