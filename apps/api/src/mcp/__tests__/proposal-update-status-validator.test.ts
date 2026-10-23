import { AdrStatus } from 'src/generated/model/adrStatus';
import {
  getAllowedProposalUpdateStatuses,
  validateProposalUpdateStatus,
} from '../tools/proposal-update-status-validator';

const TASK_USER_SETTABLE = [
  'BACKLOG',
  'ACTIVE',
  'ON_HOLD',
  'VERIFYING',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
] as const;

describe('validateProposalUpdateStatus', () => {
  describe('APPROVED is rejected for every known target type', () => {
    it.each(['TASK', 'FEATURE', 'DESIGN_DOC'])(
      'rejects APPROVED for %s',
      (target) => {
        const result = validateProposalUpdateStatus(target, 'APPROVED');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain(target);
          expect(result.error).toContain('APPROVED');
        }
      },
    );
  });

  describe('TASK', () => {
    it.each(TASK_USER_SETTABLE)('accepts %s', (status) => {
      expect(validateProposalUpdateStatus('TASK', status)).toEqual({
        ok: true,
      });
    });

    it.each([
      'READY',
      'IN_PROGRESS',
      'NOT_STARTED',
      'REFINING_CONTENT',
      'COMPLETE',
      'APPROVED',
      'REJECTED',
      'DRAFT',
    ])('rejects cross-type value %s', (status) => {
      const result = validateProposalUpdateStatus('TASK', status);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('TASK');
        expect(result.error).toContain(status);
      }
    });

    it('rejects SUPERSEDED with a directive error pointing at proposal edges', () => {
      const result = validateProposalUpdateStatus('TASK', 'SUPERSEDED');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('proposal edges field');
      }
    });
  });

  describe('FEATURE', () => {
    it.each(TASK_USER_SETTABLE)('accepts %s', (status) => {
      expect(validateProposalUpdateStatus('FEATURE', status)).toEqual({
        ok: true,
      });
    });

    it('rejects READY (a design-doc status) for FEATURE', () => {
      const result = validateProposalUpdateStatus('FEATURE', 'READY');
      expect(result.ok).toBe(false);
    });
  });

  describe('DESIGN_DOC', () => {
    it.each(Object.values(AdrStatus))('accepts %s', (status) => {
      expect(validateProposalUpdateStatus('DESIGN_DOC', status)).toEqual({
        ok: true,
      });
    });

    it.each([
      'ACTIVE',
      'BACKLOG',
      'IN_PROGRESS',
      'NOT_STARTED',
      'COMPLETED',
      'APPROVED',
    ])('rejects cross-type value %s', (status) => {
      const result = validateProposalUpdateStatus('DESIGN_DOC', status);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('DESIGN_DOC');
      }
    });
  });

  describe('error message shape', () => {
    it('lists the full set of valid values for the target type', () => {
      const result = validateProposalUpdateStatus('TASK', 'APPROVED');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const valid of TASK_USER_SETTABLE) {
          expect(result.error).toContain(valid);
        }
      }
    });

    it('lists the full set of valid values for DESIGN_DOC', () => {
      const result = validateProposalUpdateStatus('DESIGN_DOC', 'bogus');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const valid of Object.values(AdrStatus)) {
          expect(result.error).toContain(valid);
        }
      }
    });
  });

  describe('unsupported target types', () => {
    it('passes through unknown target types without rejecting', () => {
      expect(
        validateProposalUpdateStatus('SOME_FUTURE_TYPE', 'anything'),
      ).toEqual({ ok: true });
    });
  });
});

describe('getAllowedProposalUpdateStatuses', () => {
  it('returns the task user-settable subset for TASK', () => {
    expect(getAllowedProposalUpdateStatuses('TASK')).toEqual(
      TASK_USER_SETTABLE,
    );
  });

  it('returns the task user-settable subset for FEATURE', () => {
    expect(getAllowedProposalUpdateStatuses('FEATURE')).toEqual(
      TASK_USER_SETTABLE,
    );
  });

  it('returns AdrStatus values for DESIGN_DOC', () => {
    expect(getAllowedProposalUpdateStatuses('DESIGN_DOC')).toEqual(
      Object.values(AdrStatus),
    );
  });

  it('returns undefined for unknown target types', () => {
    expect(getAllowedProposalUpdateStatuses('UNKNOWN')).toBeUndefined();
  });
});
