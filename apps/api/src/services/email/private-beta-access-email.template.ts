import type { PrivateBetaAccessRequestId } from '../../types';

export interface PrivateBetaAccessEmailRequest {
  requestId: PrivateBetaAccessRequestId;
  name: string;
  submittedEmail: string;
  organizationName: string;
  teamSize: number | null;
  productContext: string | null;
  accessRationale: string | null;
}

export interface RenderedPrivateBetaAccessEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '�')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function buildHtmlDocument(title: string, body: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body style="margin:0;padding:32px 16px;background:#f4f4f5;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">',
    '<tr><td style="padding:32px;">',
    '<div style="color:#087e8b;font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;">Hey Hey</div>',
    body,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

function buildTextDocument(title: string, body: string): string {
  return [`Hey Hey — ${title}`, '', body].join('\n');
}

export function renderPrivateBetaAccessRequesterEmail(
  request: Pick<PrivateBetaAccessEmailRequest, 'requestId' | 'name'>,
): RenderedPrivateBetaAccessEmail {
  const nameHtml = escapeHtml(request.name);
  const nameText = escapeText(request.name);
  const requestIdHtml = escapeHtml(request.requestId);
  const requestIdText = escapeText(request.requestId);
  const subject = 'We received your Hey Hey beta signup';
  const textBody = [
    `Hi ${nameText},`,
    '',
    'We received and stored your beta signup. When admission is authorized, we will email your activation link. If admissions are paused, your signup will wait for review.',
    'We will follow up by email when there is an update.',
    'This message confirms receipt only; it is not an acceptance and does not promise a review decision or timing.',
    '',
    `Request reference: ${requestIdText}`,
  ].join('\n');
  const htmlBody = [
    '<h1 style="font-size:24px;line-height:1.3;margin:16px 0 20px;">We received your request</h1>',
    `<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hi ${nameHtml},</p>`,
    '<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">We received and stored your beta signup. When admission is authorized, we will email your activation link. If admissions are paused, your signup will wait for review.</p>',
    '<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">We will follow up by email when there is an update.</p>',
    '<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">This message confirms receipt only; it is not an acceptance and does not promise a review decision or timing.</p>',
    `<p style="font-size:13px;line-height:1.5;color:#6b7280;margin:24px 0 0;">Request reference: <span style="font-family:monospace;">${requestIdHtml}</span></p>`,
  ].join('\n');

  return {
    subject,
    html: buildHtmlDocument(subject, htmlBody),
    text: buildTextDocument(subject, textBody),
  };
}

export function renderPrivateBetaAccessOperatorEmail(
  request: PrivateBetaAccessEmailRequest,
): RenderedPrivateBetaAccessEmail {
  const fields = [
    ['Request ID', request.requestId],
    ['Name', request.name],
    ['Submitted email', request.submittedEmail],
    ['Organization', request.organizationName],
    ...(request.teamSize === null
      ? []
      : [['Team size', String(request.teamSize)]]),
    ...(request.productContext === null
      ? []
      : [['Product context', request.productContext]]),
    ...(request.accessRationale === null
      ? []
      : [['Access rationale', request.accessRationale]]),
  ] as const;
  const subject = `Private beta access request ${request.requestId}`;
  const textBody = [
    'A beta signup has been received. Check the stored request for its current authorization and provisioning state.',
    '',
    ...fields.map(([label, value]) => `${label}: ${escapeText(value)}`),
    '',
    'The stored request is authoritative. This email is only a notification of the durable record.',
  ].join('\n');
  const htmlRows = fields
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px 8px 0;vertical-align:top;font-weight:600;">${escapeHtml(label)}</td><td style="padding:8px 0;vertical-align:top;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`,
    )
    .join('\n');
  const htmlBody = [
    '<h1 style="font-size:24px;line-height:1.3;margin:16px 0 20px;">Private beta access request</h1>',
    '<p style="font-size:16px;line-height:1.5;margin:0 0 20px;">A beta signup has been received. Check the stored request for its current authorization and provisioning state.</p>',
    `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5;">${htmlRows}</table>`,
    '<p style="font-size:15px;line-height:1.5;margin:24px 0 0;color:#374151;">The stored request is authoritative. This email is only a notification of the durable record.</p>',
  ].join('\n');

  return {
    subject,
    html: buildHtmlDocument(subject, htmlBody),
    text: buildTextDocument(subject, textBody),
  };
}

export function renderPrivateBetaAccessExistingAccountEmail(params: {
  name: string;
  signInUrl: string;
}): RenderedPrivateBetaAccessEmail {
  const nameHtml = escapeHtml(params.name);
  const nameText = escapeText(params.name);
  const signInUrlHtml = escapeHtml(params.signInUrl);
  const subject = 'You already have a Hey Hey account';
  const textBody = [
    `Hi ${nameText},`,
    '',
    'Someone used this email address to sign up for the Hey Hey beta, but it already belongs to a Hey Hey account. There is nothing new to activate — sign in with your existing account instead.',
    '',
    `Sign in: ${params.signInUrl}`,
    '',
    'Forgot your password? Choose "Forgot credentials?" on the sign-in page to reset it.',
    '',
    "If this wasn't you, you can safely ignore this email. Your account has not changed.",
  ].join('\n');
  const htmlBody = [
    '<h1 style="font-size:24px;line-height:1.3;margin:16px 0 20px;">You already have an account</h1>',
    `<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hi ${nameHtml},</p>`,
    '<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Someone used this email address to sign up for the Hey Hey beta, but it already belongs to a Hey Hey account. There is nothing new to activate — sign in with your existing account instead.</p>',
    `<p style="font-size:16px;line-height:1.5;margin:0 0 16px;"><a href="${signInUrlHtml}" style="color:#087e8b;font-weight:600;">Sign in to Hey Hey</a></p>`,
    `<p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Forgot your password? Choose “Forgot credentials?” on the <a href="${signInUrlHtml}" style="color:#087e8b;">sign-in page</a> to reset it.</p>`,
    '<p style="font-size:14px;line-height:1.5;color:#6b7280;margin:24px 0 0;">If this wasn\'t you, you can safely ignore this email. Your account has not changed.</p>',
  ].join('\n');

  return {
    subject,
    html: buildHtmlDocument(subject, htmlBody),
    text: buildTextDocument(subject, textBody),
  };
}
