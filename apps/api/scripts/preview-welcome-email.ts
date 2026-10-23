import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { renderWelcomeEmail } from '../src/services/email/welcome-email.template';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match?.slice(prefix.length);
};

const recipientName = flag('name') ?? 'Ada Lovelace';
const temporaryPassword = flag('password') ?? 'Tr@nsient-Pa55!';
const welcomeUrl =
  flag('welcomeUrl') ??
  'https://heyhey.dev/?welcome=1&name=Ada%20Lovelace&email=ada%40example.com';

const { subject, html, text } = renderWelcomeEmail({
  recipientName,
  temporaryPassword,
  welcomeUrl,
});

const dir = mkdtempSync(join(tmpdir(), 'welcome-email-'));
const htmlPath = join(dir, 'welcome.html');
const textPath = join(dir, 'welcome.txt');

writeFileSync(htmlPath, html, 'utf8');
writeFileSync(textPath, text, 'utf8');

console.log(`Subject: ${subject}`);
console.log(`HTML:    ${htmlPath}`);
console.log(`Text:    ${textPath}`);

if (process.platform === 'darwin') {
  execSync(`open "${htmlPath}"`);
} else {
  console.log('Open the HTML path above in a browser to preview.');
}
