/** Add references only to executable handler launches; signed history remains byte-for-byte. */
import { z } from 'zod/v4';
import type { JsonValue } from '../../../durable-data';

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const fileSchema = z.strictObject({ records: z.array(z.json()), quarantined: z.array(z.json()) });

export function migrateSessionFileV2ToV3(file: JsonValue): JsonValue {
  const body = fileSchema.parse(file);
  return {
    ...body,
    records: body.records.map((record) => {
      if (
        !isObject(record) ||
        !['queued', 'picked', 'started'].includes(String(record['state'])) ||
        record['kind'] !== 'trigger_frame'
      )
        return record;
      const frame = record['payload'];
      const event = isObject(frame) ? frame['event'] : undefined;
      const payload = isObject(event) ? event['payload'] : undefined;
      if (
        !isObject(frame) ||
        !isObject(event) ||
        event['promptType'] !== 'start_run' ||
        !isObject(payload) ||
        typeof payload['handlerPromptType'] !== 'string' ||
        'attachments' in payload
      )
        return record;
      return {
        ...record,
        payload: { ...frame, event: { ...event, payload: { ...payload, attachments: [] } } },
      };
    }),
  };
}
