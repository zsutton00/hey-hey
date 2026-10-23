import { renderWelcomeEmail } from '../welcome-email.template';

describe('renderWelcomeEmail', () => {
  const welcomeUrl =
    'https://app.example.com/?welcome=1&name=Ada#welcomeCredential=welcome-token';
  const baseParams = {
    welcomeUrl,
  };

  it('greets a named recipient by name', () => {
    const { html, text } = renderWelcomeEmail({
      ...baseParams,
      recipientName: 'Ada Lovelace',
    });

    expect(text).toContain('Hi Ada Lovelace,');
    expect(html).toContain('Hi Ada Lovelace,');
  });

  it('falls back to a generic greeting when recipientName is null and never echoes an email local-part', () => {
    const { html, text } = renderWelcomeEmail({
      ...baseParams,
      recipientName: null,
    });

    expect(text).toContain('Hi there,');
    expect(html).toContain('Hi there,');
    // The local-part of the example user must never leak into the greeting.
    expect(text).not.toMatch(/Hi\s+[a-zA-Z0-9._%+-]+@/);
    expect(html).not.toMatch(/Hi\s+[a-zA-Z0-9._%+-]+@/);
  });

  it('renders an HTML body with a CTA and URL fallback without disclosing a password', () => {
    const { html } = renderWelcomeEmail({
      ...baseParams,
      recipientName: 'Ada',
    });

    // CTA href matches welcomeUrl exactly (with HTML-encoded ampersands).
    expect(html).toMatch(
      /<a\s+href="https:\/\/app\.example\.com\/\?welcome=1&amp;name=Ada#welcomeCredential=welcome-token"[^>]*>\s*Join Hey Hey\s*<\/a>/,
    );

    // Plain-text URL fallback link to the same URL — CTA href + fallback paragraph anchor.
    const occurrences = (
      html.match(
        /https:\/\/app\.example\.com\/\?welcome=1&amp;name=Ada#welcomeCredential=welcome-token/g,
      ) ?? []
    ).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);

    expect(html).not.toMatch(/temporary password/i);
    expect(html).not.toContain('Choose your password</a>');

    // No <style> blocks — inline CSS only.
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<\/style>/i);
  });

  it('renders a plain-text body with greeting, framing, and the secure URL, with no HTML tags', () => {
    const { text } = renderWelcomeEmail({
      ...baseParams,
      recipientName: 'Ada',
    });

    expect(text).toContain('Hi Ada,');
    expect(text).toMatch(/account is ready/i);
    expect(text).toContain(welcomeUrl);
    expect(text).toContain(`Join Hey Hey: ${welcomeUrl}`);
    expect(text).not.toContain(`Choose your password: ${welcomeUrl}`);
    expect(text).not.toMatch(/temporary password/i);
    expect(text).toMatch(/didn[’']t expect this email/i);

    // No HTML tags in the text body.
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it('subject names the product and the action', () => {
    const { subject } = renderWelcomeEmail({
      ...baseParams,
      recipientName: 'Ada',
    });

    expect(subject).toMatch(/hey hey/i);
    expect(subject).toMatch(/welcome|account is ready/i);
  });
});
