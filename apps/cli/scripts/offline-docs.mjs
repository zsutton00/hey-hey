// Writes dist/docs: the recovery guidance a person or their agent can read without a network or a
// running application. The canonical text stays in apps/api/content/help, so the web help and
// this copy cannot drift; the build fails loudly when a listed article is absent.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Article slugs shipped offline. Keep in step with OFFLINE_DOC_FILES in src/local-app/offline-docs.ts. */
export const OFFLINE_DOC_SLUGS = [
  'protected-credential-store-failures',
  'local-startup-troubleshooting',
];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u;

async function readArticle(helpDirectory, slug, fileNames) {
  for (const fileName of fileNames) {
    const source = await readFile(path.join(helpDirectory, fileName), 'utf8');
    const match = FRONTMATTER.exec(source);
    if (!match) {
      continue;
    }
    const field = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'mu').exec(match[1])?.[1]?.trim();
    if (field('slug') === slug) {
      return { title: field('title') ?? slug, body: match[2].trim() };
    }
  }
  throw new Error(
    `Offline documentation build: no article with slug "${slug}" in ${helpDirectory}. Add it to the help content or remove it from OFFLINE_DOC_SLUGS.`,
  );
}

export async function writeOfflineDocs({ helpDirectory, outDirectory, version }) {
  const { readdir } = await import('node:fs/promises');
  const fileNames = (await readdir(helpDirectory)).filter((name) => name.endsWith('.md')).sort();
  const header = `<!-- Hey Hey CLI ${version}. Copied from the Hey Hey help source at build time. -->`;
  const articles = [];
  for (const slug of OFFLINE_DOC_SLUGS) {
    articles.push({ slug, ...(await readArticle(helpDirectory, slug, fileNames)) });
  }
  await rm(outDirectory, { recursive: true, force: true });
  await mkdir(outDirectory, { recursive: true });
  for (const article of articles) {
    await writeFile(
      path.join(outDirectory, `${article.slug}.md`),
      `${header}\n\n# ${article.title}\n\n${article.body}\n`,
    );
  }
  await writeFile(
    path.join(outDirectory, 'index.md'),
    [
      `# Hey Hey CLI ${version} setup and troubleshooting`,
      '',
      `These articles were written for CLI ${version} and ship inside the installed package, so they are readable offline and while the application is not running.`,
      '',
      ...articles.map((article) => `- [${article.title}](${article.slug}.md)`),
      '',
      'Show the troubleshooting prompt for the newest failed attempt with: `heyhey local troubleshoot`',
      '',
    ].join('\n'),
  );
}
