export interface WelcomeEmailParams {
  recipientName: string | null;
  welcomeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND_NAME = 'Hey Hey';
const BRAND_COLOR = '#087e8b';
const BRAND_COLOR_DARK = '#06646f';
const TEXT_COLOR = '#1a1a1a';
const MUTED_COLOR = '#6b7280';
const SURFACE_COLOR = '#f4f4f5';
const BORDER_COLOR = '#e5e7eb';

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildGreeting(recipientName: string | null): string {
  if (recipientName && recipientName.trim().length > 0) {
    return `Hi ${recipientName.trim()},`;
  }
  return 'Hi there,';
}

export function renderWelcomeEmail(params: WelcomeEmailParams): RenderedEmail {
  const greeting = buildGreeting(params.recipientName);
  const subject = `Welcome to ${BRAND_NAME} — your account is ready`;

  const html = buildHtml({
    greeting,
    welcomeUrl: params.welcomeUrl,
  });

  const text = buildText({
    greeting,
    welcomeUrl: params.welcomeUrl,
  });

  return { subject, html, text };
}

function buildHtml(args: {
  greeting: string;
  welcomeUrl: string;
}): string {
  const safeGreeting = escapeHtml(args.greeting);
  const safeWelcomeUrl = escapeHtml(args.welcomeUrl);

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Welcome to ${BRAND_NAME}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${SURFACE_COLOR};font-family:${FONT_STACK};color:${TEXT_COLOR};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${SURFACE_COLOR};padding:32px 16px;">`,
    '<tr><td align="center">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;border:1px solid ${BORDER_COLOR};overflow:hidden;">`,
    '<tr><td style="padding:32px 32px 8px 32px;">',
    `<div style="font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_COLOR};">${BRAND_NAME}</div>`,
    `<h1 style="font-family:${FONT_STACK};font-size:24px;line-height:1.3;margin:12px 0 0 0;color:${TEXT_COLOR};">Welcome to ${BRAND_NAME}</h1>`,
    '</td></tr>',
    '<tr><td style="padding:16px 32px 0 32px;">',
    `<p style="font-size:16px;line-height:1.5;margin:0 0 16px 0;color:${TEXT_COLOR};">${safeGreeting}</p>`,
    `<p style="font-size:16px;line-height:1.5;margin:0 0 24px 0;color:${TEXT_COLOR};">Your ${BRAND_NAME} account is ready. Follow this secure welcome link to choose your password.</p>`,
    '</td></tr>',
    '<tr><td align="center" style="padding:0 32px 8px 32px;">',
    `<a href="${safeWelcomeUrl}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 24px;border-radius:8px;border:1px solid ${BRAND_COLOR_DARK};">Join Hey Hey</a>`,
    '</td></tr>',
    '<tr><td align="center" style="padding:0 32px 24px 32px;">',
    `<p style="font-size:13px;line-height:1.5;margin:8px 0 0 0;color:${MUTED_COLOR};">Or paste this link into your browser:<br><a href="${safeWelcomeUrl}" style="color:${BRAND_COLOR};word-break:break-all;">${safeWelcomeUrl}</a></p>`,
    '</td></tr>',
    `<tr><td style="padding:16px 32px 32px 32px;border-top:1px solid ${BORDER_COLOR};">`,
    `<p style="font-size:12px;line-height:1.5;margin:0;color:${MUTED_COLOR};">Didn’t expect this email? You can safely ignore it — no action is needed.</p>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

function buildText(args: {
  greeting: string;
  welcomeUrl: string;
}): string {
  return [
    `Welcome to ${BRAND_NAME}`,
    '',
    args.greeting,
    '',
    `Your ${BRAND_NAME} account is ready. Follow this secure welcome link to choose your password.`,
    '',
    `Join Hey Hey: ${args.welcomeUrl}`,
    '',
    'Didn’t expect this email? You can safely ignore it — no action is needed.',
  ].join('\n');
}
