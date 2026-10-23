export const errorToLoggable = (error: unknown) => {
  if (error instanceof Error) {
    return `message: ${error.message}, name: ${error.name}, stack: ${error.stack}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  return JSON.stringify(error);
};

/**
 * Extracts the downstream HTTP response detail from an axios error. For a cross-
 * service call, `error.message` is only ever the transport outcome (e.g. "Request
 * failed with status code 500"); the actual remote error lives in the response
 * body. Returns `undefined` when the error carries no response (e.g. a connection
 * failure), so it can be spread into a log context without adding noise.
 */
export const axiosResponseToLoggable = (error: unknown) => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { response } = error as {
    response?: { data?: unknown; status?: number };
  };
  if (!response) {
    return undefined;
  }
  return { status: response.status, data: response.data };
};
