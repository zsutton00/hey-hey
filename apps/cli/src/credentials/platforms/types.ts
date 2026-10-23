export interface PlatformStore {
  store(key: string, value: string): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  name: string;
}
