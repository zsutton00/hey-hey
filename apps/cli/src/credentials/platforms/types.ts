export interface PlatformStore {
  store(key: string, value: string): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  /** Optional proof that the store can hold credentials; `accountPrefix` scopes any probe entry. */
  ensureReady?(accountPrefix: string): Promise<void>;
  name: string;
}
