import * as fs from 'fs';
import * as path from 'path';
import { getContentFromMessageData } from '../message-content.util';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const loadFixture = (filename: string): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8'),
  ) as Record<string, unknown>;

describe('getContentFromMessageData', () => {
  it('returns null when data is missing', () => {
    expect(getContentFromMessageData('USER', undefined)).toBeNull();
  });

  it('extracts user content from comment payloads', () => {
    const data = { comment: '  Ready to proceed with onboarding.  ' };
    expect(getContentFromMessageData('USER', data)).toBe(
      'Ready to proceed with onboarding.',
    );
  });

  it('extracts system content from response', () => {
    const data = { response: '  Welcome! How can I help?  ' };
    expect(getContentFromMessageData('SYSTEM', data)).toBe(
      'Welcome! How can I help?',
    );
  });

  it('falls back to message when response is missing', () => {
    const data = { message: '  Processing your request...  ' };
    expect(getContentFromMessageData('SYSTEM', data)).toBe(
      'Processing your request...',
    );
  });

  it('extracts system content from opener fixture', () => {
    const data = loadFixture('opener-message.json');
    expect(getContentFromMessageData('SYSTEM', data)).toBe(
      'opener processing completed',
    );
  });

  it('extracts system content from plan fixture', () => {
    const data = loadFixture('plan-message.json');
    expect(getContentFromMessageData('SYSTEM', data)).toBe(
      data.response as string,
    );
  });

  it('extracts system content from long response fixture', () => {
    const data = loadFixture('system-message-long-response.json');
    expect(getContentFromMessageData('SYSTEM', data)).toBe(
      data.response as string,
    );
  });
});
