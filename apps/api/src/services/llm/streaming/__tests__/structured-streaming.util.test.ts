import z from 'zod';
import {
  ARRAY_LIKE_FIELDS,
  applyStructuredDelta,
  createSchemaFieldValidators,
  ensureSystemMessageData,
  getCurrentDeltaValue,
} from '../structured-streaming.util';
import type { MutableIntermediateSystemMessageData } from '../structured-streaming.util';
import type { IntermediateSystemMessageData } from 'src/types/flow-internal.types';

describe('structured-streaming.util', () => {
  describe('applyStructuredDelta', () => {
    it('updates arrays in place respecting indexes', () => {
      const state: MutableIntermediateSystemMessageData = {};
      expect(applyStructuredDelta(state, 'uiElements', { id: 'a' }, 0)).toBe(
        true,
      );
      expect(applyStructuredDelta(state, 'uiElements', { id: 'a' }, 0)).toBe(
        false,
      );
      expect(state.uiElements).toEqual([{ id: 'a' }]);
    });

    it('clones object values to avoid mutation leaks', () => {
      const state: MutableIntermediateSystemMessageData = {};
      const payload = { nested: { value: 1 } };
      applyStructuredDelta(state, 'response', payload);
      expect(state.response).toEqual(payload);
      (payload.nested as any).value = 2;
      expect(state.response).toEqual({ nested: { value: 1 } });
    });
  });

  describe('createSchemaFieldValidators', () => {
    it('tracks array-like fields and validates delta values', () => {
      ARRAY_LIKE_FIELDS.delete('testArray');

      const schema = z.object({
        testArray: z.array(z.object({ id: z.string() })),
        response: z.string(),
      });

      const validators = createSchemaFieldValidators(schema);

      expect(ARRAY_LIKE_FIELDS.has('testArray')).toBe(true);
      const responseValidator = validators.response;
      if (!responseValidator) {
        throw new Error('Expected response validator');
      }
      expect(() => responseValidator.validateValue('ok')).not.toThrow();
      expect(() =>
        validators.testArray?.validateItem?.({ id: 'item-1' }),
      ).not.toThrow();

      ARRAY_LIKE_FIELDS.delete('testArray');
    });
  });

  describe('getCurrentDeltaValue', () => {
    it('returns the requested entry for array fields', () => {
      const state: MutableIntermediateSystemMessageData = {
        actions: [{ label: 'first' }, { label: 'second' }],
      };

      const current = getCurrentDeltaValue(state, 'actions', 1);

      expect(current).toEqual({ label: 'second' });
    });

    it('returns undefined for missing entries', () => {
      const state: MutableIntermediateSystemMessageData = {};
      expect(getCurrentDeltaValue(state, 'actions')).toBeUndefined();
    });
  });

  describe('ensureSystemMessageData', () => {
    it('returns empty object when input is undefined', () => {
      expect(ensureSystemMessageData()).toEqual({});
    });
  });
});
