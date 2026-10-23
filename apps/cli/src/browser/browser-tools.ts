import type { BrowserCall } from './browser-tool-schemas';
import { isAllowedBrowserUrl, RunTabs } from './run-tabs';
import type { ServerLogger } from '../server/logger';
type BrowserContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/png' };
export interface BrowserResult {
  content: BrowserContent[];
  isError?: boolean;
}
const textResult = (text: string): BrowserResult => ({
  content: [{ type: 'text', text: text.slice(0, 100_000) }],
});

export class BrowserTools {
  public constructor(
    private readonly tabs: RunTabs,
    private readonly logger: ServerLogger,
  ) {}
  public async execute(
    runId: string,
    projectId: string,
    call: BrowserCall,
    admitted: () => boolean,
  ): Promise<BrowserResult> {
    this.logger.debug('browser.tool.started', { runId, tool: call.name });
    try {
      const result = await this.tabs.use(
        runId,
        projectId,
        async (family, owned): Promise<BrowserResult> => {
          const page = owned.page;
          switch (call.name) {
            case 'navigate':
              if (!isAllowedBrowserUrl(call.arguments.url))
                throw new Error('Unsupported navigation scheme');
              owned.refs.clear();
              await page.goto(call.arguments.url, {
                waitUntil: 'domcontentloaded',
                timeout: 10_000,
              });
              return textResult('Navigation completed.');
            case 'snapshot': {
              owned.refs.clear();
              const snapshot = (await page.ariaSnapshot({ mode: 'ai', timeout: 10_000 })).slice(
                0,
                100_000,
              );
              for (const match of snapshot.matchAll(/\[ref=(e\d+)\]/gu)) owned.refs.add(match[1]!);
              return textResult(snapshot);
            }
            case 'click':
            case 'type': {
              const ref = call.arguments.ref;
              if (ref && !owned.refs.has(ref))
                throw new Error('Stale snapshot reference; take a new snapshot');
              const locator = ref ? page.getByRef(ref) : page.locator(call.arguments.selector!);
              owned.refs.clear();
              if (call.name === 'click') await locator.click({ timeout: 10_000 });
              else await locator.fill(call.arguments.text, { timeout: 10_000 });
              return textResult('Action completed.');
            }
            case 'screenshot': {
              const bytes = await page.screenshot({ type: 'png', timeout: 10_000 });
              if (bytes.length > 8_000_000) throw new Error('Screenshot too large');
              return {
                content: [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }],
              };
            }
            case 'evaluate': {
              owned.refs.clear();
              let timer: ReturnType<typeof setTimeout> | undefined;
              let timedOut = false;
              try {
                const result = await Promise.race([
                  page.evaluate(async (expression: string): Promise<string> => {
                    const serialized = JSON.stringify(await globalThis.eval(expression));
                    if (serialized === undefined || serialized.length > 100_000)
                      throw new Error('Result must be bounded JSON');
                    return serialized;
                  }, call.arguments.expression),
                  new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                      timedOut = true;
                      reject(new Error('Evaluation timed out'));
                    }, 10_000);
                  }),
                ]);
                return textResult(result);
              } catch {
                if (timedOut) {
                  owned.unusable = true;
                  void page.close({ runBeforeUnload: false }).catch(() => {
                    this.logger.warn('browser.evaluation.cleanup_failed', { runId });
                  });
                }
                throw new Error('Evaluation failed');
              } finally {
                clearTimeout(timer);
              }
            }
            case 'console_messages':
              return textResult(JSON.stringify(owned.console));
            case 'list_pages':
              return textResult(
                JSON.stringify(
                  [...family.pages.values()]
                    .filter((entry) => !entry.unusable && !entry.page.isClosed())
                    .map((entry) => ({ pageId: entry.id, selected: entry === family.selected })),
                ),
              );
            case 'select_page': {
              const selected = family.pages.get(call.arguments.pageId);
              if (!selected || selected.unusable || selected.page.isClosed())
                throw new Error('Page does not belong to this Run');
              owned.refs.clear();
              selected.refs.clear();
              family.selected = selected;
              return textResult('Page selected.');
            }
          }
        },
        admitted,
      );
      this.logger.debug('browser.tool.completed', { runId, tool: call.name });
      return result;
    } catch {
      this.logger.debug('browser.tool.failed', { runId, tool: call.name });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Browser operation failed. Refresh the snapshot or retry with valid arguments and an owned page.',
          },
        ],
      };
    }
  }
}
