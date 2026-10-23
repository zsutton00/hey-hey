import { renderPasswordRecoveryEmail } from '../password-recovery-email.template';

describe('renderPasswordRecoveryEmail', () => {
  it('renders the fragment credential only inside the supplied recovery URL', () => {
    const recoveryUrl =
      'https://app.example.test/change-password#recoveryCredential=secret';
    const rendered = renderPasswordRecoveryEmail({
      recipientName: 'Person',
      recoveryUrl,
    });

    expect(rendered.subject).toBe('Your Hey Hey recovery instructions');
    expect(rendered.text).toContain(
      'We received a request to recover access to your Hey Hey account.',
    );
    expect(rendered.text).toContain('Recover your account:');
    expect(rendered.html).toContain('>Recover your account</a>');
    expect(rendered.text).not.toContain('Use this secure, single-use link');
    expect(rendered.html).not.toContain('Use this secure, single-use link');
    expect(rendered.text).toContain(recoveryUrl);
    expect(rendered.html).toContain(recoveryUrl);
    expect(rendered.text).not.toContain('person@example.com');
  });
});
