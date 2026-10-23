import { randomUUID } from 'node:crypto';
import type { BrowserContext, Frame, Page } from 'playwright-core';
import { z } from 'zod';
import type { ServerLogger } from '../server/logger';
import {
  ANNOTATION_BINDING,
  ANNOTATION_SYNC_EVENT,
  annotationOverlaySource,
} from './annotation-overlay';
import type { MockupServe, MockupServes } from './mockup-serves';

export interface BrowserAnnotation {
  id: string;
  url: string;
  selector: string;
  role: string;
  text: string;
  note: string;
  /** The `data-hh-id` of the element or its nearest ancestor that has one. */
  elementId: string | null;
  /** Set only from what the CLI served to this page, never from the page's own message. */
  mockup: MockupServe | null;
}

/** What the overlay on one page needs to draw its markers. */
export interface AnnotationPageView {
  total: number;
  annotations: Array<{ id: string; number: number; selector: string; note: string }>;
}

const MAX_ANNOTATIONS_PER_RUN = 100;
const note = z.string().max(2_000);
const id = z.string().uuid();
const annotationMessageSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      annotation: z
        .object({
          selector: z.string().min(1).max(1_000),
          role: z.string().min(1).max(100),
          text: z.string().max(300),
          note,
          elementId: z.string().min(1).max(200).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ op: z.literal('update'), id, note }).strict(),
  z.object({ op: z.literal('remove'), id }).strict(),
  z.object({ op: z.literal('clear') }).strict(),
  z.object({ op: z.literal('list') }).strict(),
]);
const annotationEnvelopeSchema = z
  .object({ nonce: z.string(), message: annotationMessageSchema })
  .strict();

/** Each Run's pending annotations, in the order the user made them. Memory only. */
class AnnotationStore {
  private readonly runs = new Map<string, BrowserAnnotation[]>();

  public list(runId: string): readonly BrowserAnnotation[] {
    return this.runs.get(runId) ?? [];
  }
  public add(runId: string, annotation: Omit<BrowserAnnotation, 'id'>): void {
    const list = this.runs.get(runId) ?? [];
    if (list.length >= MAX_ANNOTATIONS_PER_RUN) throw new Error('Too many annotations');
    list.push({ id: randomUUID(), ...annotation });
    this.runs.set(runId, list);
  }
  public update(runId: string, annotationId: string, note: string): void {
    const annotation = this.list(runId).find((entry) => entry.id === annotationId);
    if (annotation) annotation.note = note;
  }
  public remove(runId: string, annotationIds: ReadonlySet<string>): void {
    const kept = this.list(runId).filter((entry) => !annotationIds.has(entry.id));
    if (kept.length > 0) this.runs.set(runId, kept);
    else this.runs.delete(runId);
  }
  public drop(runId: string): void {
    this.runs.delete(runId);
  }
}

const withoutHash = (url: string): string => url.replace(/#.*$/su, '');

const displayUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      return `${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    // Not a parseable URL; show it as recorded.
  }
  return url;
};

/** The agent-facing block for a Turn's pending annotations. */
export const formatBrowserAnnotations = (annotations: readonly BrowserAnnotation[]): string =>
  [
    'Browser annotations:',
    ...annotations.map((annotation, index) => {
      const text = annotation.text ? ` ${JSON.stringify(annotation.text)}` : '';
      const lines = [
        `${String(index + 1)}. ${displayUrl(annotation.url)} - ${annotation.selector} ${annotation.role}${text}`,
      ];
      if (annotation.mockup) {
        const { mockup } = annotation;
        const element = annotation.elementId ? `, element ${annotation.elementId}` : '';
        lines.push(
          mockup.kind === 'proposal'
            ? `   Mockup: proposal ${mockup.proposalId}, section ${mockup.sectionKey}, size ${mockup.sizeKey}${element}`
            : `   Mockup: ${mockup.mockupId}, size ${mockup.sizeKey}, revision ${mockup.revision}${element}`,
        );
      }
      if (annotation.note) lines.push(`   Note: ${annotation.note}`);
      return lines.join('\n');
    }),
  ].join('\n');

/** How the Run's Turn preparation reads and settles its pending annotations. */
export interface BrowserAnnotationDelivery {
  pending(runId: string): readonly BrowserAnnotation[];
  delivered(runId: string, annotationIds: readonly string[]): void;
}

export interface AnnotationPageOwners {
  ownerOf(page: Page): string | null;
  pagesOf(runId: string): Page[];
}

/**
 * Takes annotations from the overlay on Run-owned pages and holds them per Run.
 * The owning Run comes only from the page that called the binding, never from
 * the message.
 */
export class PageAnnotations implements BrowserAnnotationDelivery {
  private readonly store = new AnnotationStore();
  private readonly installed = new WeakMap<BrowserContext, Promise<void>>();
  /** Known only to the overlay's closure, so page scripts cannot call the binding with it directly. */
  private readonly nonce = randomUUID();

  public constructor(
    private readonly owners: AnnotationPageOwners,
    private readonly serves: MockupServes,
    private readonly logger: ServerLogger,
  ) {}

  /** One binding and overlay script per browser context; every Run's pages share them. */
  public install(context: BrowserContext): Promise<void> {
    let installing = this.installed.get(context);
    if (!installing) {
      installing = (async () => {
        await context.exposeBinding(ANNOTATION_BINDING, (source, raw: unknown) =>
          this.receive(source.page, source.frame, raw),
        );
        await context.addInitScript({ content: annotationOverlaySource(this.nonce) });
      })();
      this.installed.set(context, installing);
    }
    return installing;
  }

  public pending(runId: string): readonly BrowserAnnotation[] {
    return [...this.store.list(runId)];
  }

  public delivered(runId: string, annotationIds: readonly string[]): void {
    this.store.remove(runId, new Set(annotationIds));
    for (const page of this.owners.pagesOf(runId)) this.sync(page);
  }

  public drop(runId: string): void {
    this.store.drop(runId);
  }

  /** Asks the page's overlay to re-read its markers. */
  public sync(page: Page): void {
    void page
      .evaluate((event: string) => {
        window.dispatchEvent(new Event(event));
      }, ANNOTATION_SYNC_EVENT)
      .catch(() => {
        // A page mid-navigation re-reads its markers when the new document loads.
        this.logger.debug('browser.annotations.sync_skipped');
      });
  }

  private receive(page: Page, frame: Frame, raw: unknown): AnnotationPageView {
    const runId = this.owners.ownerOf(page);
    if (runId === null || frame !== page.mainFrame()) {
      throw new Error('Annotations are accepted only from Run pages');
    }
    const parsed = annotationEnvelopeSchema.safeParse(raw);
    if (!parsed.success || parsed.data.nonce !== this.nonce) {
      this.logger.warn('browser.annotations.message_rejected', { runId });
      throw new Error('Invalid annotation message');
    }
    const message = parsed.data.message;
    const url = frame.url();
    switch (message.op) {
      case 'add':
        this.store.add(runId, {
          url,
          ...message.annotation,
          elementId: message.annotation.elementId ?? null,
          mockup: this.serves.shownOn(page, url),
        });
        break;
      case 'update':
        this.store.update(runId, message.id, message.note);
        break;
      case 'remove':
        this.store.remove(runId, new Set([message.id]));
        break;
      case 'clear':
        this.store.drop(runId);
        break;
      case 'list':
        break;
    }
    if (message.op !== 'list') {
      for (const other of this.owners.pagesOf(runId)) if (other !== page) this.sync(other);
    }
    return this.view(runId, url);
  }

  /** Only this page's own annotations go back into the page; other pages' notes stay out of it. */
  private view(runId: string, url: string): AnnotationPageView {
    const all = this.store.list(runId);
    return {
      total: all.length,
      annotations: all
        .map((annotation, index) => ({ annotation, number: index + 1 }))
        .filter(({ annotation }) => withoutHash(annotation.url) === withoutHash(url))
        .map(({ annotation, number }) => ({
          id: annotation.id,
          number,
          selector: annotation.selector,
          note: annotation.note,
        })),
    };
  }
}
