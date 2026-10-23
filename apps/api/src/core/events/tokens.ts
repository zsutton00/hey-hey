// Tokens for Nest DI to avoid circular string dependencies

export const DOMAIN_EVENT_PUBLISHER_TOKEN = Symbol(
  'DOMAIN_EVENT_PUBLISHER_TOKEN',
);
export const MESSAGE_BUS_TOKEN = Symbol('MESSAGE_BUS_TOKEN');
export const EVENT_ROUTER_TOKEN = Symbol('EVENT_ROUTER_TOKEN');
export const OUTBOX_STORE_TOKEN = Symbol('OUTBOX_STORE_TOKEN');
export const OUTBOX_PUBLISHER_TOKEN = Symbol('OUTBOX_PUBLISHER_TOKEN');
