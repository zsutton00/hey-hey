export interface PasswordRecoveryEmailParams {
  recipientName: string | null;
  recoveryUrl: string;
}

export interface RenderedPasswordRecoveryEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const renderPasswordRecoveryEmail = (
  params: PasswordRecoveryEmailParams,
): RenderedPasswordRecoveryEmail => {
  const greeting = params.recipientName
    ? `Hi ${params.recipientName.trim()},`
    : 'Hi there,';
  const safeUrl = escapeHtml(params.recoveryUrl);
  return {
    subject: 'Your Hey Hey recovery instructions',
    html: [
      '<!DOCTYPE html>',
      '<html lang="en"><body>',
      `<p>${escapeHtml(greeting)}</p>`,
      '<p>We received a request to recover access to your Hey Hey account.</p>',
      `<p><a href="${safeUrl}">Recover your account</a></p>`,
      '<p>If you did not request this, you can safely ignore this email.</p>',
      '</body></html>',
    ].join('\n'),
    text: [
      greeting,
      '',
      'We received a request to recover access to your Hey Hey account.',
      '',
      `Recover your account: ${params.recoveryUrl}`,
      '',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
  };
};
