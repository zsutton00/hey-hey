import { readOpenItemsBrowserRecord } from "@hey-hey/ui-common/data";
export { readOpenItemsBrowserRecord as readPersistedOpenItems } from "@hey-hey/ui-common/data";
export const parseOpenItems = (value: string | null) =>
  readOpenItemsBrowserRecord(value).items;
