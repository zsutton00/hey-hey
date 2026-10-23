import { DiagnosticFeed } from '../server/diagnostic-feed';
import { describe, expect, it } from 'vitest';
import { initialNavigation, navigate } from './navigation';
import {
  machineStatus,
  metadata,
  narration,
  NOW,
  session,
  state,
  tool,
} from './presentation.test-support';
import { bodyHeight } from './screen-model';
import { ceremonyViewModel } from './screens/ceremony/view-model';
import { debugViewModel, diagnosticsFeedHeight } from './screens/debug/view-model';
import { menuViewModel } from './screens/menu/view-model';
import { optionsViewModel } from './screens/options/view-model';
import { quitViewModel } from './screens/quit/view-model';
import { sessionViewModel } from './screens/session/view-model';
import { layoutRow } from './components/frame';
import { rowText, type Row } from './text';

const texts = (rows: readonly Row[]): string[] => rows.map(rowText);
/** Rows exactly as the frame lays them out, trailing padding removed. */
const drawn = (rows: readonly Row[], columns: number, color = false): string[] =>
  rows.map((source) =>
    layoutRow(source, columns, color)
      .map((part) => part.text)
      .join('')
      .trimEnd(),
  );
const run = { runId: 'run-1', runInstanceId: 1 };

describe('optionsViewModel', () => {
  it('lists Intent-first as off with the machine-wide note', () => {
    const model = optionsViewModel(
      state({
        options: {
          intentFirst: false,
          remoteToolCallViewing: true,
          jevParentFeatureFilter: true,
          jevKeyDefined: true,
        },
      }),
    );
    expect(model.title).toBe('OPTIONS');
    expect(model.aside).toBe('This machine');
    expect(texts(model.body)).toEqual([
      'AGENTS',
      'Intent-first (experimental)  Off   Enter to turn on',
      'Agents write and ask in terms of what you want and will see',
      '',
      'Remote tool-call viewing  On   Enter to turn off',
      "Let your other devices see this machine's agents' tool calls",
      '',
      'Jev-filtered parent feature load  On   Enter to turn off',
      'Project Assistant starts with only the parent requirements Jev judges relevant. Needs a Jev key.',
      '',
      'Applies to every project on this machine. New sessions pick up changes.',
    ]);
    expect(model.footer).toBe('Esc back  ↑↓ move  Enter switch  q quit');
  });

  it('shows the Jev row as unavailable without a key, even when the saved choice is on', () => {
    const body = texts(
      optionsViewModel(
        state({
          options: {
            intentFirst: false,
            remoteToolCallViewing: true,
            jevParentFeatureFilter: true,
            jevKeyDefined: false,
          },
        }),
      ).body,
    );
    expect(body).toContain('Jev-filtered parent feature load  Unavailable');
    expect(body).toContain(
      'Needs a Jev key. Define TYPESAFE_API_KEY in your environment to use this.',
    );
    expect(body.join('\n')).not.toContain('Jev-filtered parent feature load  On');
  });

  it('lists Intent-first as on with the way to turn it off', () => {
    const body = texts(
      optionsViewModel(
        state({
          options: {
            intentFirst: true,
            remoteToolCallViewing: true,
            jevParentFeatureFilter: true,
            jevKeyDefined: true,
          },
        }),
      ).body,
    );
    expect(body).toContain('Intent-first (experimental)  On   Enter to turn off');
  });

  it('shows the choice as being checked until it has been read', () => {
    expect(
      texts(
        optionsViewModel(
          state({
            options: {
              intentFirst: null,
              remoteToolCallViewing: null,
              jevParentFeatureFilter: null,
              jevKeyDefined: true,
            },
          }),
        ).body,
      ),
    ).toContain('Intent-first (experimental)  Checking…');
    expect(texts(optionsViewModel(state()).body)).toContain(
      'Intent-first (experimental)  Checking…',
    );
  });

  it('shows the current notice above the option', () => {
    const navigation = navigate(initialNavigation(), { kind: 'notice', message: 'Could not save' });
    const body = texts(
      optionsViewModel(
        state({
          navigation,
          options: {
            intentFirst: false,
            remoteToolCallViewing: true,
            jevParentFeatureFilter: true,
            jevKeyDefined: true,
          },
        }),
      ).body,
    );
    expect(body[0]).toBe('Could not save');
  });
});

describe('menuViewModel', () => {
  it('shows account, connection and readiness on one line, then sessions, machine actions and diagnostics', () => {
    const model = menuViewModel(state());
    const body = texts(model.body);
    expect(body[0]).toBe('Account signed in   Machine connected   Execution ready');
    expect(body).toContain('Pair  Pair this machine with Hey Hey');
    expect(body).toContain('Log out  Account only');
    expect(body).toContain('Options  Choose how agents work on this machine');
    const order = ['SESSIONS ON THIS MACHINE  0', 'MACHINE', 'OPTIONS', 'DIAGNOSTICS'].map((text) =>
      body.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  const STATUS = 'Account signed in   Machine connected   Execution ready';

  it('keeps the status line unchanged on the default profile and production', () => {
    expect(texts(menuViewModel(state()).body)[0]).toBe(STATUS);
  });

  it('adds Profile to the status line when a profile is set', () => {
    const body = texts(
      menuViewModel(state({ target: { profile: 'e2e', environment: null } })).body,
    );
    expect(body[0]).toBe(`${STATUS}   Profile e2e`);
  });

  it('names staging, or the server host otherwise, as Environment on the status line', () => {
    for (const [environment, label] of [
      ['localhost:3000', 'localhost:3000'],
      ['staging.heyhey.dev', 'Staging'],
    ] as const) {
      const body = texts(menuViewModel(state({ target: { profile: null, environment } })).body);
      expect(body[0]).toBe(`${STATUS}   Environment ${label}`);
    }
  });

  it('adds profile then environment to the status line together', () => {
    const body = texts(
      menuViewModel(state({ target: { profile: 'e2e', environment: 'localhost:3000' } })).body,
    );
    expect(body[0]).toBe(`${STATUS}   Profile e2e   Environment localhost:3000`);
  });

  it('lays labels left and hints right within a capped width, with no row selected without sessions', () => {
    const model = menuViewModel(state({ viewport: { columns: 200, rows: 40 } }));
    const rows = drawn(model.body, 100);
    const pair = rows.find((text) => text.includes('Pair this machine with Hey Hey')) ?? '';
    expect(pair).toMatch(/^ {3}Pair {2,}Pair this machine with Hey Hey$/u);
    expect(pair).toHaveLength(100);
    expect(rows.some((text) => text.startsWith(' > '))).toBe(false);
    expect(texts(model.body)).toContain('No sessions on this machine');
    expect(model.body.some((source) => source.kind === 'divider')).toBe(true);
  });

  it('marks the selection with > alone when color is off, and a background and bar when on', () => {
    const model = menuViewModel(state({ sessions: [session()] }));
    const selected = model.body.find(
      (source) => source.kind === 'line' && source.selected === true,
    );
    if (!selected) throw new Error('expected a selected row');
    expect(drawn([selected], 80)[0]).toMatch(/^ > Loading title…/u);
    const colored = layoutRow(selected, 80, true);
    expect(colored[0]?.text).toBe('▌');
    expect(colored.every((part) => part.background === true)).toBe(true);
    expect(layoutRow(selected, 80, false).some((part) => part.background === true)).toBe(false);
  });

  it('shows Pair greyed out with its reason once the machine is paired', () => {
    const machine = machineStatus({
      actions: [
        {
          id: 'pair',
          label: 'Pair',
          availability: { available: false, reason: 'already-paired' },
        },
        { id: 'add-controller', label: 'Add controller', availability: { available: true } },
        { id: 'log-out', label: 'Log out', availability: { available: true } },
      ],
    });
    const pair = menuViewModel(state({ machine })).body.find((source) =>
      rowText(source).startsWith('Pair  '),
    );
    expect(pair && rowText(pair)).toBe('Pair  Already paired');
    expect(pair?.kind === 'line' && pair.left.every((part) => part.tone === 'muted')).toBe(true);
  });

  it('labels an unavailable action with its reason instead of hiding it', () => {
    const machine = machineStatus({
      actions: [
        { id: 'pair', label: 'Pair', availability: { available: true } },
        {
          id: 'add-controller',
          label: 'Add controller',
          availability: { available: false, reason: 'machine-not-paired' },
        },
        { id: 'log-out', label: 'Log out', availability: { available: true } },
      ],
    });
    const body = texts(menuViewModel(state({ machine })).body);
    expect(body).toContain('Add controller  Pair this machine first');
  });

  it('lists sessions with title, effective state, duration and context, without color', () => {
    const listed = session();
    const model = menuViewModel(
      state({
        sessions: [listed],
        metadata: new Map([['run-1', metadata()]]),
        selection: { kind: 'session', run },
      }),
    );
    const body = texts(model.body);
    expect(body).toContain('Investigate a failing build  Thinking for 2m 14s');
    expect(body).toContain('Codex');
    expect(model.footer).toContain('o open in web');
  });

  it('puts one blank row between sessions and keeps the surrounding sections compact', () => {
    const first = session();
    const second = session({ runId: 'run-2', conversationId: 'conversation-2' });
    const model = menuViewModel(
      state({
        sessions: [first, second],
        metadata: new Map([
          [
            'run-1',
            metadata({ title: { status: 'available', value: 'First session', fetchedAt: '' } }),
          ],
          [
            'run-2',
            metadata({
              runId: 'run-2',
              conversationId: 'conversation-2',
              title: { status: 'available', value: 'Second session', fetchedAt: '' },
            }),
          ],
        ]),
      }),
    );
    const firstTitle = model.body.findIndex((source) =>
      rowText(source).startsWith('First session  '),
    );
    const secondTitle = model.body.findIndex((source) =>
      rowText(source).startsWith('Second session  '),
    );
    const sessionsHeading = model.body.findIndex((source) =>
      rowText(source).startsWith('SESSIONS ON THIS MACHINE'),
    );

    expect(firstTitle).toBe(sessionsHeading + 1);
    expect(model.body[firstTitle + 1]?.kind).toBe('line');
    expect(model.body[firstTitle + 2]).toEqual({ kind: 'line', left: [] });
    expect(secondTitle).toBe(firstTitle + 3);
    expect(model.body[secondTitle + 1]?.kind).toBe('line');
    expect(model.body[secondTitle + 2]?.kind).toBe('divider');

    const body = texts(model.body);
    const pairIndex = body.indexOf('Pair  Pair this machine with Hey Hey');
    const controllerIndex = body.indexOf('Add controller  Connect another device');
    const logOutIndex = body.indexOf('Log out  Account only');
    expect(controllerIndex).toBe(pairIndex + 1);
    expect(logOutIndex).toBe(controllerIndex + 1);
  });

  it('never substitutes the entity name for a missing title', () => {
    const body = texts(
      menuViewModel(
        state({
          sessions: [session()],
          metadata: new Map([
            ['run-1', metadata({ title: { status: 'unavailable', reason: 'signed_out' } })],
          ]),
        }),
      ).body,
    );
    expect(body.some((line) => line.startsWith('Title unavailable (signed out)  '))).toBe(true);
  });

  it('shows loading metadata explicitly and omits the duration for idle sessions', () => {
    const body = texts(
      menuViewModel(
        state({
          sessions: [
            session({ effectiveState: { state: 'IDLE', observedAt: new Date(NOW).toISOString() } }),
          ],
          metadata: new Map([['run-1', metadata({ title: { status: 'loading' } })]]),
        }),
      ).body,
    );
    expect(body).toContain('Loading title…  Idle');
  });

  it('shows approval waits as their own state', () => {
    const body = texts(
      menuViewModel(
        state({
          sessions: [
            session({
              effectiveState: {
                state: 'AWAITING_APPROVAL',
                observedAt: new Date(NOW - 48_000).toISOString(),
              },
            }),
          ],
        }),
      ).body,
    );
    expect(body.some((line) => line.endsWith('  Awaiting approval for 48s'))).toBe(true);
    expect(body).toContain('Loading context… · Codex');
  });

  it('says when there are no sessions and while starting', () => {
    expect(texts(menuViewModel(state()).body)).toContain('No sessions on this machine');
    const starting = texts(
      menuViewModel(state({ startup: { kind: 'starting' }, machine: null })).body,
    );
    expect(starting).toContain('Starting Hey Hey…');
    expect(starting).toContain('Sessions appear once Hey Hey has started');
    expect(starting).toContain('Pair  Starting…');
  });

  it('fits many sessions into a short terminal while keeping the selection visible', () => {
    const sessions = Array.from({ length: 20 }, (_, index) =>
      session({ runId: `run-${String(index)}`, conversationId: `c-${String(index)}` }),
    );
    const metadataByRun = new Map(
      sessions.map((listed, index) => [
        listed.runId,
        metadata({
          runId: listed.runId,
          conversationId: listed.conversationId,
          title: { status: 'available' as const, value: `Session ${String(index)}`, fetchedAt: '' },
        }),
      ]),
    );
    const viewport = { columns: 80, rows: 24 };
    const model = menuViewModel(
      state({
        sessions,
        metadata: metadataByRun,
        viewport,
        selection: { kind: 'session', run: { runId: 'run-15', runInstanceId: 1 } },
      }),
    );
    expect(model.body.length).toBeLessThanOrEqual(bodyHeight(viewport.rows));
    const sessionRows = model.body.filter(
      (source) => source.kind === 'line' && rowText(source).startsWith('Session '),
    );
    const selected = sessionRows.find(
      (source) => source.kind === 'line' && source.selected === true,
    );
    expect(selected && rowText(selected)).toContain('Session 15');
    expect(
      model.body.filter((source) => source.kind === 'line' && source.left.length === 0),
    ).toHaveLength(Math.max(0, sessionRows.length - 1));
    expect(texts(model.body).some((line) => line.includes('more session'))).toBe(true);
  });

  it('shows the explanation after a selected Run was removed', () => {
    const navigation = navigate(
      navigate(initialNavigation(), { kind: 'open', screen: { kind: 'session', run } }),
      { kind: 'run-removed', run },
    );
    expect(texts(menuViewModel(state({ navigation })).body)).toContain(
      'That session ended and left this machine.',
    );
  });
});

describe('menuViewModel Shared Browser', () => {
  it('omits the section until the server is running', () => {
    expect(texts(menuViewModel(state()).body)).not.toContain('SHARED BROWSER');
  });

  it('shows the machine toggle and each project browser by name (its ID until known), running or stopped, between machine and diagnostics', () => {
    const body = texts(
      menuViewModel(
        state({
          sharedBrowser: {
            enabled: true,
            projects: [
              { projectId: 'project-a', name: 'Website', status: 'running' },
              { projectId: 'project-b', name: null, status: 'stopped' },
            ],
          },
        }),
      ).body,
    );
    const order = ['MACHINE', 'SHARED BROWSER', 'DIAGNOSTICS'].map((text) => body.indexOf(text));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain('Shared Browser  On   Enter to turn off');
    expect(body).toContain('Website  running   Enter to close');
    expect(body).toContain('Project project-b  stopped');
  });

  it('shows the setting as off, or checking before it is read', () => {
    const off = texts(
      menuViewModel(state({ sharedBrowser: { enabled: false, projects: [] } })).body,
    );
    expect(off).toContain('Shared Browser  Off   Enter to turn on');
    const reading = texts(
      menuViewModel(state({ sharedBrowser: { enabled: null, projects: [] } })).body,
    );
    expect(reading).toContain('Shared Browser  Checking…');
  });
});

describe('sessionViewModel', () => {
  const focused = (entries = [narration(1, 'Tracing the build.'), tool(2)]) =>
    state({
      sessions: [session()],
      metadata: new Map([['run-1', metadata()]]),
      activity: { run, entries, gap: { evictedCount: 0, throughSeq: null } },
    });

  it('shows identity, state and the read-only activity feed', () => {
    const model = sessionViewModel(focused(), run);
    const body = texts(model.body);
    expect(body[0]).toBe('Investigate a failing build  Thinking for 2m 14s');
    expect(body).toContain('Codex · Active here 05:00 · This machine');
    expect(body).toContain('ACTIVITY  Following live');
    expect(body).toContain('04:50  Agent');
    expect(body).toContain('Tracing the build.');
    expect(body).toContain('04:50  › Shell  running · 10s');
    expect(body).toContain('$ pnpm test');
    expect(model.body.find((source) => rowText(source) === '$ pnpm test')?.kind).toBe('block');
    const rows = drawn(model.body, 80);
    expect(rows).toContain('     │ $ pnpm test');
    expect(rows.find((text) => text.startsWith('04:50  › Shell'))).toMatch(/running · 10s$/u);
    expect(model.footer).toContain('o open in web');
  });

  it('draws no more rows than fit, newest last, for high-volume output', () => {
    const output = Array.from({ length: 5_000 }, (_, index) => `line ${String(index)}`).join('\n');
    const viewport = { columns: 80, rows: 20 };
    const model = sessionViewModel(
      { ...focused([tool(1, { output: { text: output, truncatedBytes: 0 } })]), viewport },
      run,
    );
    expect(model.body.length).toBeLessThanOrEqual(bodyHeight(viewport.rows));
    expect(rowText(model.body.at(-1) ?? { kind: 'divider' })).toBe('line 4999');
  });

  it('pins the feed while scrolled and says new activity arrived', () => {
    const model = sessionViewModel(
      {
        ...focused([narration(1, 'first'), narration(2, 'second')]),
        activityScroll: { mode: 'paused', pinnedThroughSeq: 1, offset: 0 },
      },
      run,
    );
    const body = texts(model.body);
    expect(body).toContain('ACTIVITY  Paused · new activity below · f to follow live');
    expect(body).toContain('first');
    expect(body).not.toContain('second');
  });

  it('reports evicted history and truncated text', () => {
    const model = sessionViewModel(
      {
        ...focused([
          tool(9, {
            status: 'failed',
            exitCode: 2,
            result: { text: 'boom', truncatedBytes: 2048 },
          }),
        ]),
        activity: {
          run,
          entries: [
            tool(9, {
              status: 'failed',
              exitCode: 2,
              result: { text: 'boom', truncatedBytes: 2048 },
            }),
          ],
          gap: { evictedCount: 8, throughSeq: 8 },
        },
      },
      run,
    );
    const body = texts(model.body);
    expect(body).toContain('Earlier activity is no longer kept (8 entries).');
    expect(body.some((line) => line.endsWith('✗ Shell  failed · exit 2 · 0s'))).toBe(true);
    expect(body).toContain('… 2.0 KB not kept');
  });

  it('labels subagent activity and an unnamed tool honestly', () => {
    const entry = tool(1, {
      toolName: null,
      lane: { subagentTurnId: 'sub-1', providerThreadId: null, parentToolUseId: null },
    });
    const body = texts(sessionViewModel(focused([entry]), run).body);
    expect(body.some((line) => line.includes('Tool (name not reported) (subagent)'))).toBe(true);
  });

  it('shows feature ancestry and the focal entity', () => {
    const withContext = metadata({
      focalContext: {
        status: 'available',
        fetchedAt: '',
        value: {
          focalEntity: { entityType: 'TASK', entityId: 'task-1' },
          entity: { name: 'Fix the build' } as never,
          featureAncestry: [
            { id: 'f2', name: 'Build reliability', relationship: 'ancestor', distance: 1 } as never,
            { id: 'f1', name: 'Example project', relationship: 'ancestor', distance: 2 } as never,
          ],
        },
      },
    });
    const body = texts(
      sessionViewModel({ ...focused(), metadata: new Map([['run-1', withContext]]) }, run).body,
    );
    expect(body).toContain('Example project / Build reliability / Fix the build');
  });

  it('disables web handoff honestly when route data is missing', () => {
    const model = sessionViewModel(
      { ...focused(), sessions: [session({ conversationId: '' })] },
      run,
    );
    expect(model.footer).toContain('web link unavailable');
  });
});

describe('debugViewModel', () => {
  it('shows records, losses and follow state', () => {
    const model = debugViewModel(
      state({
        diagnostics: {
          ...new DiagnosticFeed().snapshot(),
          records: [
            {
              kind: 'console',
              seq: 3,
              timestamp: new Date(NOW).toISOString(),
              stream: 'stderr',
              source: 'write',
              text: 'library warning',
              truncatedBytes: 0,
            },
          ],
          evictedCount: 2,
          droppedReentrantCount: 1,
          exportResult: null,
        },
      }),
    );
    const body = texts(model.body);
    expect(body[0]).toBe('Following live');
    expect(body[1]).toBe(
      '1 entry held · 2 earlier entries evicted · 0 expired · 0 repetitions summarized · 1 nested record dropped',
    );
    expect(body.some((line) => line.endsWith('STDERR library warning'))).toBe(true);
    expect(model.footer).toContain('e export');
  });

  it('draws no title header and gives its rows to the feed', () => {
    const model = debugViewModel(
      state({ diagnostics: { ...new DiagnosticFeed().snapshot(), exportResult: null } }),
    );
    expect(model.title).toBeUndefined();
    expect(model.aside).toBeUndefined();
    expect(diagnosticsFeedHeight(30)).toBe(bodyHeight(30) + 2 - 3);
  });

  it('shows the export path and counts after a successful export', () => {
    const model = debugViewModel(
      state({
        diagnostics: {
          ...new DiagnosticFeed().snapshot(),
          records: [],
          evictedCount: 4,
          droppedReentrantCount: 0,
          exportResult: {
            kind: 'success',
            path: '/tmp/heyhey/exports/debug-2026-10-07T12-34-56.789Z.jsonl',
            count: 2,
            evictedCount: 4,
            expiredCount: 0,
          },
        },
      }),
    );
    const body = texts(model.body);
    expect(body).toContain('Exported 2 entries; 4 earlier entries evicted; 0 entries expired.');
    expect(body).toContain('/tmp/heyhey/exports/debug-2026-10-07T12-34-56.789Z.jsonl');
  });

  it('keeps the newest diagnostics visible after adding the export result rows', () => {
    const model = debugViewModel(
      state({
        viewport: { columns: 100, rows: 12 },
        diagnostics: {
          ...new DiagnosticFeed().snapshot(),
          records: Array.from({ length: 10 }, (_, index) => ({
            kind: 'log' as const,
            seq: index + 1,
            timestamp: new Date(NOW).toISOString(),
            level: 'info' as const,
            event: 'test',
            text: `record-${index + 1}`,
            truncatedBytes: 0,
          })),
          evictedCount: 0,
          droppedReentrantCount: 0,
          exportResult: {
            kind: 'success',
            path: '/tmp/debug.jsonl',
            count: 10,
            evictedCount: 0,
            expiredCount: 0,
          },
        },
      }),
    );

    expect(texts(model.body).some((line) => line.endsWith('INFO  record-10'))).toBe(true);
  });

  it('shows the export failure reason', () => {
    const model = debugViewModel(
      state({
        diagnostics: {
          ...new DiagnosticFeed().snapshot(),
          records: [],
          evictedCount: 0,
          droppedReentrantCount: 0,
          exportResult: { kind: 'failure', message: 'Permission denied' },
        },
      }),
    );
    expect(texts(model.body)).toContain('Export failed: Permission denied');
  });

  it.each([
    [{ kind: 'choosing' } as const, 'Choose where to save the export in the save dialog.'],
    [{ kind: 'cancelled' } as const, 'Export cancelled.'],
  ])('shows the %o export state', (exportResult, text) => {
    const model = debugViewModel(
      state({
        diagnostics: {
          ...new DiagnosticFeed().snapshot(),
          records: [],
          evictedCount: 0,
          droppedReentrantCount: 0,
          exportResult,
        },
      }),
    );
    expect(texts(model.body)).toContain(text);
  });
});

describe('ceremonyViewModel', () => {
  it('shows the browser handoff with its route and code', () => {
    const model = ceremonyViewModel(
      state({
        ceremony: {
          actionId: 'add-controller',
          step: { kind: 'browser-handoff', userCode: 'ABCD-1234' },
          browserUrl: 'https://heyhey.dev/add-controller?code=ABCD-1234',
        },
      }),
    );
    expect(model.title).toBe('HEY HEY / add a controller');
    expect(texts(model.body)).toContain('  https://heyhey.dev/add-controller?code=ABCD-1234');
    expect(texts(model.body)).toContain('Code  ABCD-1234');
    expect(model.footer).toBe('Esc cancel');
  });

  it('asks for the local review answer', () => {
    const model = ceremonyViewModel(
      state({
        ceremony: {
          actionId: 'pair',
          browserUrl: null,
          step: {
            kind: 'local-review',
            review: {
              machineName: 'laptop',
              osFamily: 'MACOS' as never,
              controllerLabel: 'Phone',
              controllerCredentialFingerprint: 'AA:BB',
              backupEligible: true,
              backupState: false,
              expiresAt: new Date(NOW).toISOString(),
            },
          },
        },
      }),
    );
    expect(texts(model.body)).toContain('Controller   Phone');
    expect(model.footer).toBe('y approve  n decline  Esc cancel');
  });

  it('reports a finished outcome', () => {
    const model = ceremonyViewModel(
      state({
        ceremony: {
          actionId: 'pair',
          browserUrl: null,
          step: { kind: 'finished', outcome: 'expired' },
        },
      }),
    );
    expect(texts(model.body)).toEqual(['The request expired. Start again from the menu.']);
    expect(model.footer).toBe('Esc back to menu');
  });
});

describe('quitViewModel', () => {
  it('says how many working sessions quitting stops', () => {
    expect(texts(quitViewModel(state({ activeWorkCount: 2 })).body)).toContain(
      '2 sessions are working. Quitting stops them.',
    );
    expect(texts(quitViewModel(state({ activeWorkCount: 1 })).body)).toContain(
      '1 session is working. Quitting stops it.',
    );
  });
});
