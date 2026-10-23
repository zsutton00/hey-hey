import Ajv from "ajv";
import addFormats from "ajv-formats";
import type {
  ActivateOpenItemRequest,
  MigrateOpenItemsGroup,
  MigrateOpenItemsItem,
  MigrateOpenItemsRequest,
  OpenItemRef,
  OpenItemsCollection,
  OpenItemsMutationResult,
  SetOpenItemNoteRequest,
  SetOpenItemPinRequest,
  PromoteGroupToGoalResult,
} from "../api";
import { openItemsSchemas } from "../generated/open-items-contract";

const ajv = addFormats(new Ajv({ strict: false }));
export const validGroupPromotionResult = ajv.compile<PromoteGroupToGoalResult>(
  openItemsSchemas.PromoteGroupToGoalResult,
);
export const validOpenItemsCollection = ajv.compile<OpenItemsCollection>(
  openItemsSchemas.OpenItemsCollection,
);
export const validOpenItemsMutationResult =
  ajv.compile<OpenItemsMutationResult>(
    openItemsSchemas.OpenItemsMutationResult,
  );
export const validOpenItemsMigrationItem = ajv.compile<MigrateOpenItemsItem>(
  openItemsSchemas.MigrateOpenItemsItem,
);
export const validOpenItemsMigrationGroup = ajv.compile<MigrateOpenItemsGroup>(
  openItemsSchemas.MigrateOpenItemsGroup,
);
export const validOpenItemsRef = ajv.compile<OpenItemRef>(
  openItemsSchemas.OpenItemRef,
);
export const validOpenItemsActivation = ajv.compile<ActivateOpenItemRequest>(
  openItemsSchemas.ActivateOpenItemRequest,
);
export const validOpenItemsNote = ajv.compile<SetOpenItemNoteRequest>(
  openItemsSchemas.SetOpenItemNoteRequest,
);
export const validOpenItemsPin = ajv.compile<SetOpenItemPinRequest>(
  openItemsSchemas.SetOpenItemPinRequest,
);
export const validOpenItemsMigration = ajv.compile<MigrateOpenItemsRequest>(
  openItemsSchemas.MigrateOpenItemsRequest,
);
