import { http, HttpResponse } from "msw";

const unexpectedRequests: string[] = [];

// This must be the last initial handler, after shared fixtures. Runtime
// server.use() handlers still take precedence. Never open a real socket for
// an omitted mock, even if the caller catches or retries the HTTP error.
export const unexpectedRequestHandler = http.all("*", ({ request }) => {
  const description = `${request.method} ${new URL(request.url).pathname}`;
  unexpectedRequests.push(description);
  return HttpResponse.json(
    { message: `Missing test request handler: ${description}` },
    { status: 500 }
  );
});

export function takeUnexpectedRequests(): string[] {
  return unexpectedRequests.splice(0);
}
