import { EventContextManager } from '../../events/observable-event.context';

describe('Observable Events', () => {
  let contextManager: EventContextManager;

  beforeEach(() => {
    contextManager = EventContextManager.getInstance();
  });

  describe('Correlation ID Generation', () => {
    it('should generate unique correlation IDs', () => {
      const id1 = contextManager.createCorrelationId();
      const id2 = contextManager.createCorrelationId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^corr_[a-f0-9-]{36}$/); // Correlation ID format
    });

    it('should generate unique saga IDs', () => {
      const id1 = contextManager.createSagaId();
      const id2 = contextManager.createSagaId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^saga_[a-f0-9-]{36}$/); // Saga ID format
    });
  });

  describe('Context Instance', () => {
    it('should return singleton instance', () => {
      const instance1 = EventContextManager.getInstance();
      const instance2 = EventContextManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should have required methods', () => {
      expect(typeof contextManager.createCorrelationId).toBe('function');
      expect(typeof contextManager.createSagaId).toBe('function');
      expect(typeof contextManager.runWithContext).toBe('function');
    });
  });
});
