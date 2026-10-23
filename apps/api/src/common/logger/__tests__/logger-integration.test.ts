import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CustomLoggerService } from '../logger.service';
import { ErrorFileWriter } from '../error-file-writer.service';

const getErrorFileAt = (
  errorFiles: string[],
  index: number,
  label: string,
): string => {
  const errorFile = errorFiles[index];
  if (!errorFile) {
    throw new Error(`Expected ${label} error file at index ${index}`);
  }
  return errorFile;
};

describe('Logger Integration with ErrorFileWriter', () => {
  let logger: CustomLoggerService;
  let errorFileWriter: ErrorFileWriter;
  // Isolate error files per Jest worker. The writer keys off a single global
  // logs/errors directory, so without this, concurrently-running test files
  // (other workers) leak their fire-and-forget error writes into ours and
  // break the file-count assertions below.
  const testErrorsDir = path.join(
    os.tmpdir(),
    `hey-hey-error-files-test-${process.pid}`,
  );

  beforeAll(() => {
    // Set development environment for testing
    process.env.NODE_ENV = 'development';
    process.env.ERROR_FILES_DIR = testErrorsDir;
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ErrorFileWriter, CustomLoggerService],
    }).compile();

    logger = module.get<CustomLoggerService>(CustomLoggerService);
    errorFileWriter = module.get<ErrorFileWriter>(ErrorFileWriter);

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
    delete process.env.ERROR_FILES_DIR;
  });

  it('should write error file when logger.logError() is called', async () => {
    const testError = new Error('Integration logError test');
    testError.stack =
      'Error: Integration logError test\n    at test (integration.js:5:5)';
    const additionalContext = {
      userId: 'test-user-123',
      organizationId: 'test-org-456',
    };

    logger.logError(testError, additionalContext);

    // Wait a bit for async file writing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that error file was created
    const files = fs.readdirSync(testErrorsDir);
    const errorFiles = files.filter(
      (file) => file.startsWith('error_') && file.endsWith('.json'),
    );

    expect(errorFiles).toHaveLength(1);

    // Read and verify file content
    const errorFile = getErrorFileAt(errorFiles, 0, 'logError');
    const filePath = path.join(testErrorsDir, errorFile);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    expect(content.message).toBe('Integration logError test');
    expect(content.stack).toBe(testError.stack);
    expect(content.errorName).toBe('Error');
    expect(content.loggerContext).toBe('ERROR');
    expect(content.context.userId).toBe('test-user-123');
    expect(content.context.organizationId).toBe('test-org-456');
  });

  it('should not write error files when logger methods other than error are called', async () => {
    logger.log('This is a log message', 'LOG_CONTEXT');
    logger.warn('This is a warning', 'WARN_CONTEXT');
    logger.debug('This is debug info', 'DEBUG_CONTEXT');

    // Wait a bit to ensure no async operations are pending
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that no error files were created
    if (fs.existsSync(testErrorsDir)) {
      const files = fs.readdirSync(testErrorsDir);
      const errorFiles = files.filter(
        (file) => file.startsWith('error_') && file.endsWith('.json'),
      );
      expect(errorFiles).toHaveLength(0);
    }
  });

  it('should handle multiple errors and create separate files', async () => {
    const error1 = new Error('First error');
    const error2 = new Error('Second error');

    logger.logError(error1, { correlationId: 'corr-1' });
    logger.logError(error2, { correlationId: 'corr-2' });

    // Wait a bit for async file writing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that two error files were created
    const files = fs.readdirSync(testErrorsDir);
    const errorFiles = files.filter(
      (file) => file.startsWith('error_') && file.endsWith('.json'),
    );

    expect(errorFiles).toHaveLength(2);

    // Verify both files have different correlation IDs
    const file1Content = JSON.parse(
      fs.readFileSync(
        path.join(testErrorsDir, getErrorFileAt(errorFiles, 0, 'first')),
        'utf8',
      ),
    );
    const file2Content = JSON.parse(
      fs.readFileSync(
        path.join(testErrorsDir, getErrorFileAt(errorFiles, 1, 'second')),
        'utf8',
      ),
    );

    const correlationIds = [
      file1Content.context.correlationId,
      file2Content.context.correlationId,
    ];
    expect(correlationIds).toContain('corr-1');
    expect(correlationIds).toContain('corr-2');
  });

  it('should continue working even if ErrorFileWriter fails', async () => {
    // Mock ErrorFileWriter to throw an error
    jest
      .spyOn(errorFileWriter, 'writeErrorFile')
      .mockRejectedValue(new Error('File write failed'));

    // This should not throw an error
    expect(() => {
      logger.error(
        'Test error that should not crash',
        'TEST_STACK',
        'TEST_CONTEXT',
      );
    }).not.toThrow();

    // The main logger should still work (we can't easily test winston output in unit tests,
    // but we can verify the call completed without throwing)
  });
});
