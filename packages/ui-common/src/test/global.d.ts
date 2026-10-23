import type { SetupServer } from "msw/node";

declare global {
  var mswServer: SetupServer;
}

export {};
