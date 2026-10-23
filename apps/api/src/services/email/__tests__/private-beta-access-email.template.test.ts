import {
  renderPrivateBetaAccessOperatorEmail,
  renderPrivateBetaAccessRequesterEmail,
} from '../private-beta-access-email.template';
import type { PrivateBetaAccessRequestId } from '../../../types';

const request = {
  requestId:
    '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId,
  name: '<Ada & Co.>',
  submittedEmail: 'ada@example.com',
  organizationName: 'A <Company>',
  teamSize: 5,
  productContext: 'Build <tools> & test them.',
  accessRationale: 'We need "agents" for R&D.',
};

describe('private-beta access email templates', () => {
  it('keeps requester receipt meaning in HTML and text while escaping the name in HTML', () => {
    const html = renderPrivateBetaAccessRequesterEmail(request);
    const text = html.text;

    expect(html.subject).toContain('received');
    expect(html.html).toContain('&lt;Ada &amp; Co.&gt;');
    expect(html.html).not.toContain('<Ada & Co.>');
    for (const phrase of [
      'When admission is authorized',
      'If admissions are paused',
      'follow up by email',
      'not an acceptance',
      'does not promise a review decision or timing',
    ]) {
      expect(html.html).toContain(phrase);
      expect(text).toContain(phrase);
    }
    expect(text).toContain(
      'Request reference: 550e8400-e29b-41d4-a716-446655440026',
    );
    expect(text).not.toMatch(/<p[\s>]/i);
  });

  it('renders a minimal signup without inventing optional review context', () => {
    const rendered = renderPrivateBetaAccessOperatorEmail({
      ...request,
      teamSize: null,
      productContext: null,
      accessRationale: null,
    });
    expect(rendered.text).toContain(request.organizationName);
    expect(rendered.text).not.toContain('Team size:');
    expect(rendered.text).not.toContain('null');
    expect(rendered.html).not.toContain('Access rationale');
  });

  it('includes every submitted review field and marks the durable request authoritative', () => {
    const rendered = renderPrivateBetaAccessOperatorEmail(request);

    for (const value of [
      request.requestId,
      request.name,
      request.submittedEmail,
      request.organizationName,
      String(request.teamSize),
      request.productContext,
      request.accessRationale,
    ]) {
      expect(rendered.text).toContain(value);
    }
    expect(rendered.text).toContain('The stored request is authoritative');
    expect(rendered.html).toContain('&lt;Ada &amp; Co.&gt;');
    expect(rendered.html).toContain('A &lt;Company&gt;');
    expect(rendered.html).toContain('Build &lt;tools&gt; &amp; test them.');
    expect(rendered.html).not.toContain('<Company>');
    expect(rendered.html).not.toContain('<tools>');
    expect(rendered.html).toContain('The stored request is authoritative');
  });
});
