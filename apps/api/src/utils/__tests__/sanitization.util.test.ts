import {
  sanitizeArtifactTitle,
  generateQAPairTitle,
} from '../sanitization.util';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

describe('sanitizeArtifactTitle', () => {
  it('should handle valid titles', () => {
    expect(sanitizeArtifactTitle('Valid Title')).toBe('Valid Title');
    expect(sanitizeArtifactTitle('A Simple Question?')).toBe(
      'A Simple Question?',
    );
  });

  it('should handle null and undefined inputs', () => {
    expect(sanitizeArtifactTitle(null)).toBe('Untitled Artifact');
    expect(sanitizeArtifactTitle(undefined)).toBe('Untitled Artifact');
    expect(sanitizeArtifactTitle('')).toBe('Untitled Artifact');
    expect(sanitizeArtifactTitle('   ')).toBe('Untitled Artifact');
  });

  it('should use custom fallback titles', () => {
    expect(sanitizeArtifactTitle(null, 'Custom Fallback')).toBe(
      'Custom Fallback',
    );
    expect(sanitizeArtifactTitle(undefined, 'Another Fallback')).toBe(
      'Another Fallback',
    );
  });

  it('should remove dangerous characters', () => {
    expect(
      sanitizeArtifactTitle('Title with <script>alert("xss")</script>'),
    ).toBe('Title with alert("xss")');
    expect(sanitizeArtifactTitle('Title<>with>brackets')).toBe(
      'Titlewithbrackets',
    );
  });

  it('should remove control characters', () => {
    expect(sanitizeArtifactTitle('Title\x00with\x01null\x1Fbytes')).toBe(
      'Titlewithnullbytes',
    );
    expect(sanitizeArtifactTitle('Title\twith\ntabs\rand\rnewlines')).toBe(
      'Title with tabs and newlines',
    );
  });

  it('should collapse multiple spaces', () => {
    expect(sanitizeArtifactTitle('Title    with    multiple    spaces')).toBe(
      'Title with multiple spaces',
    );
    expect(
      sanitizeArtifactTitle('  Title  with  leading  and  trailing  spaces  '),
    ).toBe('Title with leading and trailing spaces');
  });

  it('should truncate long titles', () => {
    const longTitle = 'A'.repeat(300);
    const sanitized = sanitizeArtifactTitle(longTitle);
    expect(sanitized.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(sanitized.endsWith('...')).toBe(true);
  });

  it('should handle word boundary truncation', () => {
    const longTitle =
      'This is a very long title that should be truncated at word boundaries instead of cutting off in the middle of a word because that would look bad and be hard to read for users when they see truncated content';
    const sanitized = sanitizeArtifactTitle(longTitle);
    expect(sanitized.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(sanitized.endsWith('...')).toBe(true);
    // Should not end with a partial word before "..."
    const beforeEllipsis = sanitized.slice(0, -3).trim();
    const words = beforeEllipsis.split(' ');
    const lastWord = assertDefined(words[words.length - 1], 'last word');
    // Last word should be complete (not cut off mid-word)
    expect(lastWord.length).toBeGreaterThan(2);
  });

  it('should remove Unicode direction override characters', () => {
    // These characters can be used for text spoofing attacks
    expect(
      sanitizeArtifactTitle('Title\u202Awith\u202Bdirection\u202Eoverrides'),
    ).toBe('Titlewithdirectionoverrides');
  });
});

describe('generateQAPairTitle', () => {
  it('should generate proper Q&A titles', () => {
    expect(generateQAPairTitle('What is your project concept?')).toBe(
      'Response to "What is your project concept?"',
    );
    expect(generateQAPairTitle('How will you handle authentication?')).toBe(
      'Response to "How will you handle authentication?"',
    );
  });

  it('should handle invalid question text', () => {
    expect(generateQAPairTitle(null)).toBe('Q&A Response');
    expect(generateQAPairTitle(undefined)).toBe('Q&A Response');
    expect(generateQAPairTitle('')).toBe('Q&A Response');
  });

  it('should sanitize dangerous question text', () => {
    expect(
      generateQAPairTitle('Question with <script>alert("xss")</script>'),
    ).toBe('Response to "Question with alert("xss")"');
  });

  it('should handle long questions', () => {
    const longQuestion =
      'What is your strategy for handling user authentication, session management, password hashing, multi-factor authentication, OAuth integration, social login providers, and security compliance requirements in your application architecture?';
    const result = generateQAPairTitle(longQuestion);
    expect(result).toMatch(/^Response to "/);
    expect(result).toMatch(/"$/);
    expect(result.length).toBeLessThanOrEqual(220); // Account for "Response to " + quotes
  });

  it('should handle questions with control characters', () => {
    expect(generateQAPairTitle('Question\nwith\tcontrol\rcharacters')).toBe(
      'Response to "Question with control characters"',
    );
  });

  it('should handle non-string input', () => {
    expect(generateQAPairTitle(123 as any)).toBe('Q&A Response');
    expect(generateQAPairTitle({} as any)).toBe('Q&A Response');
    expect(generateQAPairTitle([] as any)).toBe('Q&A Response');
  });
});
