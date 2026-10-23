import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { ErrorFileWriter } from '../error-file-writer.service';

const getFirstErrorFile = (errorFiles: string[], label: string): string => {
  const [errorFile] = errorFiles;
  if (!errorFile) {
    throw new Error(`Expected ${label} error file to exist`);
  }
  return errorFile;
};

describe('ErrorFileWriter', () => {
  let service: ErrorFileWriter;
  const testErrorsDir = path.join(process.cwd(), 'logs', 'errors');

  beforeAll(() => {
    // Set development environment for testing
    process.env.NODE_ENV = 'development';
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ErrorFileWriter],
    }).compile();

    service = module.get<ErrorFileWriter>(ErrorFileWriter);

    // Clean up any existing test error files
    if (fs.existsSync(testErrorsDir)) {
      const files = fs.readdirSync(testErrorsDir);
      for (const file of files) {
        if (file.startsWith('error_') && file.endsWith('.json')) {
          fs.unlinkSync(path.join(testErrorsDir, file));
        }
      }
    }
  });

  afterEach(() => {
    // Clean up test error files
    if (fs.existsSync(testErrorsDir)) {
      const files = fs.readdirSync(testErrorsDir);
      for (const file of files) {
        if (file.startsWith('error_') && file.endsWith('.json')) {
          fs.unlinkSync(path.join(testErrorsDir, file));
        }
      }
    }
  });

  afterAll(() => {
    // Reset environment
    delete process.env.NODE_ENV;
  });

  describe('in development environment', () => {
    it('should be enabled in development', () => {
      const status = service.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.errorsDir).toBe(testErrorsDir);
    });

    it('should write error file with basic message', async () => {
      const testMessage = 'Test error message';
      const testContext = {
        correlationId: 'test-correlation-123',
        userId: 'user-123',
        organizationId: 'org-456',
      };

      await service.writeErrorFile(testMessage, undefined, testContext);

      // Check that error file was created
      const files = fs.readdirSync(testErrorsDir);
      const errorFiles = files.filter(
        (file) => file.startsWith('error_') && file.endsWith('.json'),
      );

      expect(errorFiles).toHaveLength(1);

      // Read and verify file content
      const errorFile = getFirstErrorFile(errorFiles, 'basic message');
      const filePath = path.join(testErrorsDir, errorFile);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      expect(content.message).toBe(testMessage);
      expect(content.level).toBe('error');
      expect(content.context.correlationId).toBe('test-correlation-123');
      expect(content.context.userId).toBe('user-123');
      expect(content.service).toBe('hey-hey-api');
      expect(content.processId).toBe(process.pid);
    });

    it('should write error file with stack trace', async () => {
      const testMessage = 'Test error with stack';
      const testStack = 'Error: Test error\n    at test (test.js:1:1)';
      const testContext = { correlationId: 'test-stack-456' };

      await service.writeErrorFile(testMessage, testStack, testContext);

      const files = fs.readdirSync(testErrorsDir);
      const errorFiles = files.filter(
        (file) => file.startsWith('error_') && file.endsWith('.json'),
      );

      expect(errorFiles).toHaveLength(1);

      const errorFile = getFirstErrorFile(errorFiles, 'stack trace');
      const filePath = path.join(testErrorsDir, errorFile);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      expect(content.stack).toBe(testStack);
    });

    it('should write error from Error object', async () => {
      const testError = new Error('Test error object');
      testError.stack = 'Error: Test error object\n    at test (test.js:1:1)';
      const testContext = { correlationId: 'test-error-obj-789' };

      await service.writeErrorFromError(testError, testContext);

      const files = fs.readdirSync(testErrorsDir);
      const errorFiles = files.filter(
        (file) => file.startsWith('error_') && file.endsWith('.json'),
      );

      expect(errorFiles).toHaveLength(1);

      const errorFile = getFirstErrorFile(errorFiles, 'error object');
      const filePath = path.join(testErrorsDir, errorFile);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      expect(content.message).toBe('Test error object');
      expect(content.stack).toBe(testError.stack);
      expect(content.errorName).toBe('Error');
    });

    it('should include additional data in error file', async () => {
      const testMessage = 'Test with additional data';
      const testContext = { correlationId: 'test-additional-123' };
      const additionalData = {
        requestPath: '/api/test',
        requestMethod: 'POST',
        userAgent: 'test-agent',
      };

      await service.writeErrorFile(
        testMessage,
        undefined,
        testContext,
        additionalData,
      );

      const files = fs.readdirSync(testErrorsDir);
      const errorFiles = files.filter(
        (file) => file.startsWith('error_') && file.endsWith('.json'),
      );

      expect(errorFiles).toHaveLength(1);

      const errorFile = getFirstErrorFile(errorFiles, 'additional data');
      const filePath = path.join(testErrorsDir, errorFile);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      expect(content.requestPath).toBe('/api/test');
      expect(content.requestMethod).toBe('POST');
      expect(content.userAgent).toBe('test-agent');
    });

    it('should handle errors without correlation ID', async () => {
      const testMessage = 'Test without correlation ID';

      await service.writeErrorFile(testMessage);

      const files = fs.readdirSync(testErrorsDir);
      const errorFiles = files.filter(
        (file) => file.startsWith('error_') && file.endsWith('.json'),
      );

      expect(errorFiles).toHaveLength(1);
      const errorFile = getFirstErrorFile(errorFiles, 'no correlation');
      expect(errorFile).toContain('no-correlation');
    });

    it('should update file count in status', async () => {
      const initialStatus = service.getStatus();
      expect(initialStatus.fileCount).toBe(0);

      await service.writeErrorFile('Test error 1', undefined, {
        correlationId: 'test-1',
      });
      await service.writeErrorFile('Test error 2', undefined, {
        correlationId: 'test-2',
      });

      const updatedStatus = service.getStatus();
      expect(updatedStatus.fileCount).toBe(2);
    });
  });

  describe('in production environment', () => {
    beforeEach(async () => {
      // Override environment for this test
      process.env.NODE_ENV = 'production';

      // Create new service instance with production environment
      const module = await Test.createTestingModule({
        providers: [ErrorFileWriter],
      }).compile();

      service = module.get<ErrorFileWriter>(ErrorFileWriter);
    });

    it('should be disabled in production', () => {
      const status = service.getStatus();
      expect(status.enabled).toBe(false);
    });

    it('should not write files in production', async () => {
      const testMessage = 'Test error in production';

      await service.writeErrorFile(testMessage);

      // Should not create any files
      if (fs.existsSync(testErrorsDir)) {
        const files = fs.readdirSync(testErrorsDir);
        const errorFiles = files.filter(
          (file) => file.startsWith('error_') && file.endsWith('.json'),
        );
        expect(errorFiles).toHaveLength(0);
      }
    });
  });
});
